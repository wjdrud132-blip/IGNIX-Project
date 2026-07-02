const express = require("express");
const router = express.Router();

const conn = require("../config/db");
const { judgeDanger, defaultThresholds, trainSensorModel } = require("../utils/aiJudge");
const { filterRowsByRegion, canViewLocation, dedupeRowsByLocation } = require("../utils/regionScope");

function displayBinId(binId) {
  return binId;
}

const SENSOR_ONLINE_LIMIT_MS = 10000;

function getSensorAgeMs(sensorCreatedAt) {
  if (!sensorCreatedAt) return null;
  const sensorTime = new Date(sensorCreatedAt).getTime();
  if (!Number.isFinite(sensorTime)) return null;
  return Date.now() - sensorTime;
}

function isSensorOnline(sensorCreatedAt) {
  const ageMs = getSensorAgeMs(sensorCreatedAt);
  return ageMs !== null && ageMs >= 0 && ageMs <= SENSOR_ONLINE_LIMIT_MS;
}

let cachedSensorModel = null;
let cachedSensorModelAt = 0;
const SENSOR_MODEL_CACHE_MS = 60000;

function getSensorModel(thresholds, callback) {
  const now = Date.now();
  if (cachedSensorModel && now - cachedSensorModelAt < SENSOR_MODEL_CACHE_MS) {
    return callback(null, cachedSensorModel);
  }

  const sql = `
    SELECT bin_id, temp, gas, flame, fire_risk
    FROM t_sensor
    WHERE temp IS NOT NULL
      AND gas IS NOT NULL
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("t_sensor AI 학습 데이터 조회 실패:", err);
      return callback(null, { available: false, sampleCount: 0, reason: "t_sensor 학습 데이터를 불러오지 못해 기존 임계값 기준을 사용합니다." });
    }

    cachedSensorModel = trainSensorModel(rows, thresholds);
    cachedSensorModelAt = now;
    callback(null, cachedSensorModel);
  });
}

function rowForCurrentSensor(row) {
  const online = isSensorOnline(row.sensor_created_at);
  if (online) {
    return {
      ...row,
      sensor_online: "Y",
      sensor_age_seconds: Math.floor(getSensorAgeMs(row.sensor_created_at) / 1000),
    };
  }

  return {
    ...row,
    sensor_online: "N",
    sensor_age_seconds: getSensorAgeMs(row.sensor_created_at) === null ? null : Math.floor(getSensorAgeMs(row.sensor_created_at) / 1000),
    network_status: 0,
    alert_type: "normal",
    alert_msg: "",
    temp_value: null,
    smoke_value: null,
    flame_value: null,
    fire_risk: null,
  };
}

function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function alertMessageFor(row) {
  if (row.alert_type === "danger") return "화재 위험 감지 - 즉각 대응 필요";
  if (row.alert_type === "warning") return "온도 및 연기 임계값 초과";
  return "";
}

function alertStatusRank(status) {
  if (status === "danger") return 2;
  if (status === "warning") return 1;
  return 0;
}

function alertStatusOf(status) {
  if (status === "danger" || status === "warning") return status;
  return "normal";
}

async function getPreviousSensorStatus(row, thresholds, aiEnabled, sensorModel) {
  const previousRows = await queryAsync(
    `SELECT
       temp AS temp_value,
       gas AS smoke_value,
       flame AS flame_value,
       fire_risk,
       created_at AS sensor_created_at
     FROM t_sensor
     WHERE bin_id = ?
       AND created_at < ?
     ORDER BY created_at DESC, sensor_id DESC
     LIMIT 1`,
    [row.bin_id, row.sensor_created_at]
  );

  if (!previousRows.length) return "normal";

  const previous = previousRows[0];
  const ruleStatus = previous.fire_risk === 2 ? "danger" : previous.fire_risk === 1 ? "warning" : "normal";
  const ai = judgeDanger(
    { ...previous, bin_id: row.bin_id, alert_type: ruleStatus, alert_msg: "" },
    thresholds,
    aiEnabled,
    sensorModel
  );

  return alertStatusOf(ai.status);
}

async function saveSensorAlertIfNeeded(row, thresholds, aiEnabled, sensorModel) {
  if (!row || row.sensor_online !== "Y") return;
  if (row.alert_type !== "danger" && row.alert_type !== "warning") return;
  if (!row.bin_id || !row.sensor_created_at || !row.mgr_id) return;

  const exists = await queryAsync(
    `SELECT alert_id
     FROM t_alert
     WHERE bin_id = ?
       AND alert_type = ?
       AND alerted_at = ?
     LIMIT 1`,
    [row.bin_id, row.alert_type, row.sensor_created_at]
  );

  if (exists.length) return;

  const previousStatus = await getPreviousSensorStatus(row, thresholds, aiEnabled, sensorModel);
  if (previousStatus === row.alert_type) return;

  await queryAsync(
    `INSERT INTO t_alert
      (bin_id, alert_type, alert_msg, alerted_at, is_received, received_at, mgr_id)
     VALUES
      (?, ?, ?, ?, 'N', ?, ?)`,
    [
      row.bin_id,
      row.alert_type,
      alertMessageFor(row),
      row.sensor_created_at,
      row.sensor_created_at,
      row.mgr_id,
    ]
  );
}

async function saveSensorAlerts(judgedRows, thresholds, aiEnabled, sensorModel) {
  const targets = judgedRows
    .filter((row) => row.alert_type === "danger" || row.alert_type === "warning")
    .sort((a, b) => alertStatusRank(b.alert_type) - alertStatusRank(a.alert_type) || new Date(a.sensor_created_at) - new Date(b.sensor_created_at));

  for (const row of targets) {
    try {
      await saveSensorAlertIfNeeded(row, thresholds, aiEnabled, sensorModel);
    } catch (err) {
      console.error("센서 알림 기록 저장 실패:", err);
    }
  }
}

router.get("/list", (req, res) => {
  const sql = `
    SELECT
      b.bin_id,
      b.bin_loc,
      b.installed_at,
      b.mgr_id,
      b.network_status,
      b.created_at,
      m.mgr_name,
      m.mgr_phone,
      a.alert_id,
      CASE
        WHEN s.fire_risk = 2 THEN 'danger'
        WHEN s.fire_risk = 1 THEN 'warning'
        WHEN a.alert_type IS NOT NULL THEN a.alert_type
        ELSE 'normal'
      END AS alert_type,
      COALESCE(a.alert_msg, '') AS alert_msg,
      COALESCE(a.alerted_at, s.created_at, b.created_at) AS alerted_at,
      a.is_received,
      s.temp AS temp_value,
      s.gas AS smoke_value,
      s.flame AS flame_value,
      s.fire_risk,
      s.created_at AS sensor_created_at
    FROM t_trashbin b
    LEFT JOIN t_manager m
      ON b.mgr_id = m.mgr_id
    LEFT JOIN (
      SELECT s1.*
      FROM t_sensor s1
      INNER JOIN (
        SELECT bin_id, MAX(created_at) AS latest_created_at
        FROM t_sensor
        GROUP BY bin_id
      ) latest_sensor
        ON s1.bin_id = latest_sensor.bin_id
       AND s1.created_at = latest_sensor.latest_created_at
    ) s ON b.bin_id = s.bin_id
    LEFT JOIN (
      SELECT a1.*
      FROM t_alert a1
      INNER JOIN (
        SELECT bin_id, MAX(alerted_at) AS latest_alerted_at
        FROM t_alert
        GROUP BY bin_id
      ) latest
        ON a1.bin_id = latest.bin_id
       AND a1.alerted_at = latest.latest_alerted_at
    ) a
      ON b.bin_id = a.bin_id
    WHERE IFNULL(b.network_status, 1) <> 9
    ORDER BY
      CASE
        WHEN s.fire_risk = 2 OR a.alert_type = 'danger' THEN 1
        WHEN s.fire_risk = 1 OR a.alert_type = 'warning' THEN 2
        ELSE 3
      END,
      b.bin_id ASC
  `

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("쓰레기통 목록 조회 실패:", err);
      return res.status(500).json({ message: "쓰레기통 목록 조회 실패" });
    }

    rows = dedupeRowsByLocation(filterRowsByRegion(req, rows, "bin_loc"), "bin_loc");

    const thresholdSql = "SELECT danger_temp, warning_temp, danger_smoke, warning_smoke FROM t_fire_threshold WHERE id = 1";
    const aiSql = "SELECT setting_value FROM t_system_setting WHERE setting_key = 'aiJudge'";

    conn.query(thresholdSql, (thresholdErr, thresholdRows) => {
      const thresholdRow = thresholdRows && thresholdRows[0];
      const thresholds = thresholdErr || !thresholdRow ? defaultThresholds : {
        dangerTemp: Number(thresholdRow.danger_temp),
        warningTemp: Number(thresholdRow.warning_temp),
        dangerSmoke: Number(thresholdRow.danger_smoke),
        warningSmoke: Number(thresholdRow.warning_smoke),
      };

      conn.query(aiSql, (aiErr, aiRows) => {
        const aiEnabled = !aiErr && aiRows && aiRows[0] ? aiRows[0].setting_value !== "N" : true;

        getSensorModel(thresholds, (modelErr, sensorModel) => {
          const judgedRows = rows.map((row) => {
            const currentRow = rowForCurrentSensor(row);
            const ruleStatus = currentRow.alert_type;
            const ai = judgeDanger(currentRow, thresholds, aiEnabled, sensorModel);
            return {
              ...currentRow,
              display_bin_id: displayBinId(currentRow.bin_id),
              rule_status: ruleStatus,
              alert_type: ai.status,
              ai_enabled: aiEnabled ? "Y" : "N",
              ai_status: ai.status,
              ai_reason: currentRow.sensor_online === "Y" ? ai.reason.join(" ") : "최근 센서 데이터 수신이 없어 오프라인으로 표시합니다.",
              ai_confidence: currentRow.sensor_online === "Y" ? ai.confidence : 0,
              ai_model_sample_count: sensorModel && sensorModel.sampleCount ? sensorModel.sampleCount : 0,
              temp_value: currentRow.sensor_online === "Y" ? ai.sensor.temp : null,
              smoke_value: currentRow.sensor_online === "Y" ? ai.sensor.smoke : null,
              flame_value: currentRow.sensor_online === "Y" ? ai.sensor.flame : null,
            };
          }).sort((a, b) => {
            const rank = (type) => type === "danger" ? 1 : type === "warning" ? 2 : 3;
            return rank(a.alert_type) - rank(b.alert_type) || Number(a.bin_id) - Number(b.bin_id);
          });
          saveSensorAlerts(judgedRows, thresholds, aiEnabled, sensorModel).finally(() => res.json(judgedRows));
        });
      });
    });
  });
});

router.get("/trash/list", (req, res) => {
  const sql = `
    SELECT
      b.bin_id,
      b.bin_loc,
      b.installed_at,
      b.mgr_id,
      b.network_status,
      b.created_at,
      m.mgr_name
    FROM t_trashbin b
    LEFT JOIN t_manager m
      ON b.mgr_id = m.mgr_id
    WHERE b.network_status = 9
    ORDER BY b.bin_id ASC
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("휴지통 목록 조회 실패:", err);
      return res.status(500).json({ message: "휴지통 목록 조회 실패" });
    }

    res.json(filterRowsByRegion(req, rows, "bin_loc").map((row) => ({ ...row, display_bin_id: displayBinId(row.bin_id) })));
  });
});

router.patch("/trash/:bin_id/restore", (req, res) => {
  const { bin_id } = req.params;

  conn.query(
    "UPDATE t_trashbin SET network_status = 1 WHERE bin_id = ? AND network_status = 9",
    [bin_id],
    (err, result) => {
      if (err) {
        console.error("\uD734\uC9C0\uD1B5 \uBCF5\uAD6C \uC2E4\uD328:", err);
        return res.status(500).json({ message: "\uBCF5\uAD6C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4." });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "\uBCF5\uAD6C\uD560 \uC4F0\uB808\uAE30\uD1B5\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
      }

      res.json({ message: "\uC4F0\uB808\uAE30\uD1B5\uC774 \uBCF5\uAD6C\uB418\uC5C8\uC2B5\uB2C8\uB2E4." });
    }
  );
});

router.delete("/trash/:bin_id", (req, res) => {
  const { bin_id } = req.params;

  conn.query("DELETE FROM t_alert WHERE bin_id = ?", [bin_id], (alertErr) => {
    if (alertErr) {
      console.error("휴지통 알림 완전 삭제 실패:", alertErr);
      return res.status(500).json({ message: "알림 데이터 삭제 실패" });
    }

    conn.query("DELETE FROM t_trashbin WHERE bin_id = ? AND network_status = 9", [bin_id], (err, result) => {
      if (err) {
        console.error("휴지통 쓰레기통 완전 삭제 실패:", err);
        return res.status(500).json({ message: "완전 삭제 실패" });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "휴지통에서 삭제할 쓰레기통을 찾을 수 없습니다." });
      }

      res.json({ message: "DB에서 완전히 삭제되었습니다." });
    });
  });
});

router.post("/", (req, res) => {
  const { bin_loc, installed_at, network_status } = req.body;
  const mgr_id = req.body.mgr_id || req.session?.user?.user_id || req.session?.user?.mgr_id;

  if (!bin_loc || !installed_at || !mgr_id) {
    return res.status(400).json({ message: "위치와 설치일을 입력하고 로그인 상태를 확인해주세요." });
  }

  const sql = `
    INSERT INTO t_trashbin
      (bin_loc, installed_at, mgr_id, network_status)
    VALUES
      (?, ?, ?, ?)
  `;

  conn.query(sql, [bin_loc, installed_at, mgr_id, network_status || 1], (err, result) => {
    if (err) {
      console.error("쓰레기통 등록 실패:", err);
      return res.status(500).json({ message: "쓰레기통 등록 실패" });
    }

    res.json({
      message: "쓰레기통이 등록되었습니다.",
      bin_id: result.insertId,
    });
  });
});

router.delete("/:bin_id", (req, res) => {
  const { bin_id } = req.params;

  const sql = `
    UPDATE t_trashbin
    SET network_status = 9
    WHERE bin_id = ?
  `;

  conn.query(sql, [bin_id], (err, result) => {
    if (err) {
      console.error("쓰레기통 휴지통 이동 실패:", err);
      return res.status(500).json({ message: "쓰레기통 휴지통 이동 실패" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "이동할 쓰레기통을 찾을 수 없습니다." });
    }

    res.json({ message: "쓰레기통이 휴지통으로 이동되었습니다." });
  });
});

module.exports = router;















