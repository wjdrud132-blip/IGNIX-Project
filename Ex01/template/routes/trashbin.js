const express = require("express");
const router = express.Router();

const conn = require("../config/db");
const { judgeDanger, defaultThresholds, trainSensorModel } = require("../utils/aiJudge");
const { filterRowsByRegion, canViewLocation, dedupeRowsByLocation } = require("../utils/regionScope");

function displayBinId(binId) {
  return binId;
}

const SENSOR_ONLINE_LIMIT_MS = 10000;
const pendingAlertKeys = new Set();

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
const SENSOR_MODEL_CACHE_MS = 300000;

function getSensorModel(thresholds, callback) {
  const now = Date.now();
  if (cachedSensorModel && now - cachedSensorModelAt < SENSOR_MODEL_CACHE_MS) {
    return callback(null, cachedSensorModel);
  }

  const sql = `
    SELECT
      bin_id,
      temp,
      gas,
      flame,
      ir_count,
      fire_risk,
      CASE
        WHEN prev_created_at IS NULL OR TIMESTAMPDIFF(SECOND, prev_created_at, created_at) <= 0 THEN NULL
        ELSE GREATEST(temp - prev_temp, 0) / GREATEST(TIMESTAMPDIFF(SECOND, prev_created_at, created_at) / 60, 1)
      END AS temp_change,
      CASE
        WHEN prev_created_at IS NULL OR TIMESTAMPDIFF(SECOND, prev_created_at, created_at) <= 0 THEN NULL
        ELSE GREATEST(gas - prev_gas, 0) / GREATEST(TIMESTAMPDIFF(SECOND, prev_created_at, created_at) / 60, 1)
      END AS gas_change
    FROM (
      SELECT
        s.*,
        LAG(s.temp) OVER (PARTITION BY s.bin_id ORDER BY s.created_at, s.sensor_id) AS prev_temp,
        LAG(s.gas) OVER (PARTITION BY s.bin_id ORDER BY s.created_at, s.sensor_id) AS prev_gas,
        LAG(s.ir_count) OVER (PARTITION BY s.bin_id ORDER BY s.created_at, s.sensor_id) AS prev_ir_count,
        LAG(s.created_at) OVER (PARTITION BY s.bin_id ORDER BY s.created_at, s.sensor_id) AS prev_created_at
      FROM (
        SELECT *
        FROM t_sensor
        WHERE temp IS NOT NULL
          AND gas IS NOT NULL
        ORDER BY created_at DESC, sensor_id DESC
        LIMIT 5000
      ) s
    ) sensor_changes
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("t_sensor AI ?숈뒿 ?곗씠??議고쉶 ?ㅽ뙣:", err);
      return callback(null, { available: false, sampleCount: 0, reason: "t_sensor ?숈뒿 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵빐 湲곗〈 ?꾧퀎媛?湲곗????ъ슜?⑸땲??" });
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
    ir_count: null,
    prev_ir_count: null,
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
  if (row.alert_type === "danger") return "?붿옱 ?꾪뿕 媛먯? - 利됯컖 ????꾩슂";
  if (row.alert_type === "warning") return "?⑤룄 諛??곌린 ?꾧퀎媛?珥덇낵";
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
       ir_count,
       fire_risk,
       created_at AS sensor_created_at
     FROM t_sensor
     WHERE bin_id = ?
       AND (
         created_at < ?
         OR (created_at = ? AND sensor_id < ?)
       )
     ORDER BY created_at DESC, sensor_id DESC
     LIMIT 1`,
    [row.bin_id, row.sensor_created_at, row.sensor_created_at, row.sensor_id || 0]
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


async function getLatestSavedAlertStatus(row) {
  const rows = await queryAsync(
    `SELECT alert_type
     FROM t_alert
     WHERE bin_id = ?
       AND alert_type IN ('danger', 'warning')
     ORDER BY alerted_at DESC, alert_id DESC
     LIMIT 1`,
    [row.bin_id]
  );

  return rows.length ? rows[0].alert_type : null;
}
async function saveSensorAlertIfNeeded(row, thresholds, aiEnabled, sensorModel) {
  if (!row || row.sensor_online !== "Y") return;
  if (row.alert_type !== "danger" && row.alert_type !== "warning") return;
  if (!row.bin_id || !row.sensor_created_at || !row.mgr_id) return;

  const alertTime = new Date(row.sensor_created_at).getTime();
  const alertKey = `${row.bin_id}|${row.alert_type}|${Number.isFinite(alertTime) ? alertTime : row.sensor_created_at}`;
  if (pendingAlertKeys.has(alertKey)) return;

  pendingAlertKeys.add(alertKey);
  try {
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
       SELECT ?, ?, ?, ?, 'N', NULL, ?
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1
         FROM t_alert
         WHERE bin_id = ?
           AND alert_type = ?
           AND alerted_at = ?
       )`,
      [
        row.bin_id,
        row.alert_type,
        alertMessageFor(row),
        row.sensor_created_at,
        row.mgr_id,
        row.bin_id,
        row.alert_type,
        row.sensor_created_at,
      ]
    );
  } finally {
    pendingAlertKeys.delete(alertKey);
  }
}
async function saveSensorAlerts(judgedRows, thresholds, aiEnabled, sensorModel) {
  const targets = judgedRows
    .filter((row) => row.alert_type === "danger" || row.alert_type === "warning")
    .sort((a, b) => alertStatusRank(b.alert_type) - alertStatusRank(a.alert_type) || new Date(a.sensor_created_at) - new Date(b.sensor_created_at));

  for (const row of targets) {
    try {
      await saveSensorAlertIfNeeded(row, thresholds, aiEnabled, sensorModel);
    } catch (err) {
      console.error("?쇱꽌 ?뚮┝ 湲곕줉 ????ㅽ뙣:", err);
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
      COALESCE(NULLIF(b.installer_name, ''), m.mgr_name) AS mgr_name,
      COALESCE(NULLIF(b.installer_phone, ''), m.mgr_phone) AS mgr_phone,
      a.alert_id,
      CASE
        WHEN s.fire_risk = 2 THEN 'danger'
        WHEN s.fire_risk = 1 THEN 'warning'
        WHEN a.alert_type IS NOT NULL THEN a.alert_type
        ELSE 'normal'
      END AS alert_type,
      COALESCE(a.alert_msg, '') AS alert_msg,
      COALESCE(s.created_at, a.alerted_at, b.created_at) AS alerted_at,
      a.is_received,
      s.sensor_id,
      s.temp AS temp_value,
      s.gas AS smoke_value,
      s.flame AS flame_value,
      s.ir_count,
      s.fire_risk,
      s.created_at AS sensor_created_at,
      s.prev_temp,
      s.prev_gas,
      s.prev_ir_count,
      s.prev_created_at,
      CASE
        WHEN s.prev_created_at IS NULL OR TIMESTAMPDIFF(SECOND, s.prev_created_at, s.created_at) <= 0 THEN NULL
        ELSE GREATEST(s.temp - s.prev_temp, 0) / GREATEST(TIMESTAMPDIFF(SECOND, s.prev_created_at, s.created_at) / 60, 1)
      END AS temp_change,
      CASE
        WHEN s.prev_created_at IS NULL OR TIMESTAMPDIFF(SECOND, s.prev_created_at, s.created_at) <= 0 THEN NULL
        ELSE GREATEST(s.gas - s.prev_gas, 0) / GREATEST(TIMESTAMPDIFF(SECOND, s.prev_created_at, s.created_at) / 60, 1)
      END AS gas_change
    FROM t_trashbin b
    LEFT JOIN t_manager m
      ON b.mgr_id = m.mgr_id
    LEFT JOIN (
      SELECT
        latest.*,
        prev.temp AS prev_temp,
        prev.gas AS prev_gas,
        prev.ir_count AS prev_ir_count,
        prev.created_at AS prev_created_at
      FROM t_sensor latest
      LEFT JOIN t_sensor prev
        ON prev.sensor_id = (
          SELECT p.sensor_id
          FROM t_sensor p
          WHERE p.bin_id = latest.bin_id
            AND (
              p.created_at < latest.created_at
              OR (p.created_at = latest.created_at AND p.sensor_id < latest.sensor_id)
            )
          ORDER BY p.created_at DESC, p.sensor_id DESC
          LIMIT 1
        )
      WHERE latest.sensor_id = (
        SELECT s2.sensor_id
        FROM t_sensor s2
        WHERE s2.bin_id = latest.bin_id
        ORDER BY s2.created_at DESC, s2.sensor_id DESC
        LIMIT 1
      )
    ) s
      ON s.bin_id = b.bin_id
    LEFT JOIN t_alert a
      ON a.alert_id = (
        SELECT a2.alert_id
        FROM t_alert a2
        WHERE a2.bin_id = b.bin_id
        ORDER BY a2.alerted_at DESC, a2.alert_id DESC
        LIMIT 1
      )
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
      console.error("?곕젅湲고넻 紐⑸줉 議고쉶 ?ㅽ뙣:", err);
      return res.status(500).json({ message: "?곕젅湲고넻 紐⑸줉 議고쉶 ?ㅽ뙣" });
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
              ai_reason: currentRow.sensor_online === "Y" ? ai.reason.join(" ") : "理쒓렐 ?쇱꽌 ?곗씠???섏떊???놁뼱 ?ㅽ봽?쇱씤?쇰줈 ?쒖떆?⑸땲??",
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
      COALESCE(NULLIF(b.installer_name, ''), m.mgr_name) AS mgr_name
    FROM t_trashbin b
    LEFT JOIN t_manager m
      ON b.mgr_id = m.mgr_id
    WHERE b.network_status = 9
    ORDER BY b.bin_id ASC
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("?댁???紐⑸줉 議고쉶 ?ㅽ뙣:", err);
      return res.status(500).json({ message: "?댁???紐⑸줉 議고쉶 ?ㅽ뙣" });
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
      console.error("?댁????뚮┝ ?꾩쟾 ??젣 ?ㅽ뙣:", alertErr);
      return res.status(500).json({ message: "?뚮┝ ?곗씠????젣 ?ㅽ뙣" });
    }

    conn.query("DELETE FROM t_trashbin WHERE bin_id = ? AND network_status = 9", [bin_id], (err, result) => {
      if (err) {
        console.error("?댁????곕젅湲고넻 ?꾩쟾 ??젣 ?ㅽ뙣:", err);
        return res.status(500).json({ message: "?꾩쟾 ??젣 ?ㅽ뙣" });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "?댁??듭뿉????젣???곕젅湲고넻??李얠쓣 ???놁뒿?덈떎." });
      }

      res.json({ message: "DB?먯꽌 ?꾩쟾????젣?섏뿀?듬땲??" });
    });
  });
});

router.post("/", (req, res) => {
  const { bin_loc, installed_at, network_status } = req.body;
  const mgr_id = req.body.mgr_id || req.session?.user?.user_id || req.session?.user?.mgr_id;
  const rawBinId = String(req.body.bin_id || req.body.display_bin_id || "").trim();
  const numericBinId = rawBinId.replace(/[^0-9]/g, "");
  const bin_id = numericBinId ? Number(numericBinId) : null;
  const installer_name = String(req.body.manager_name || req.body.installer_name || "").trim();
  const installer_phone = String(req.body.manager_phone || req.body.installer_phone || "").trim();

  if (!bin_id || !Number.isInteger(bin_id) || bin_id < 1) {
    return res.status(400).json({ message: "?곕젅湲고넻 ID瑜??낅젰?댁＜?몄슂." });
  }

  if (!bin_loc || !installed_at || !mgr_id) {
    return res.status(400).json({ message: "?꾩튂? ?ㅼ튂?쇱쓣 ?낅젰?섍퀬 濡쒓렇???곹깭瑜??뺤씤?댁＜?몄슂." });
  }

  const sql = `
    INSERT INTO t_trashbin
      (bin_id, bin_loc, installed_at, mgr_id, network_status, installer_name, installer_phone)
    VALUES
      (?, ?, ?, ?, ?, ?, ?)
  `;

  conn.query(sql, [bin_id, bin_loc, installed_at, mgr_id, network_status || 1, installer_name || null, installer_phone || null], (err) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "?대? ?깅줉???곕젅湲고넻 ID?낅땲??" });
      }

      console.error("?곕젅湲고넻 ?깅줉 ?ㅽ뙣:", err);
      return res.status(500).json({ message: "?곕젅湲고넻 ?깅줉 ?ㅽ뙣" });
    }

    res.json({
      message: "?곕젅湲고넻???깅줉?섏뿀?듬땲??",
      bin_id,
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
      console.error("?곕젅湲고넻 ?댁????대룞 ?ㅽ뙣:", err);
      return res.status(500).json({ message: "?곕젅湲고넻 ?댁????대룞 ?ㅽ뙣" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "?대룞???곕젅湲고넻??李얠쓣 ???놁뒿?덈떎." });
    }

    res.json({ message: "?곕젅湲고넻???댁??듭쑝濡??대룞?섏뿀?듬땲??" });
  });
});

router.get("/sensor-history", (req, res) => {
  const sql = `
    SELECT *
    FROM (
      SELECT
        s.sensor_id,
        s.bin_id,
        b.bin_loc,
        b.network_status,
        s.temp,
        s.gas,
        s.flame,
        s.ir_count,
        s.fire_risk,
        s.created_at
      FROM t_sensor s
      INNER JOIN t_trashbin b ON b.bin_id = s.bin_id
      WHERE IFNULL(b.network_status, 1) <> 9
      ORDER BY s.created_at DESC, s.sensor_id DESC
      LIMIT 120
    ) recent_sensor
    ORDER BY created_at ASC, sensor_id ASC
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("센서 이력 조회 실패:", err);
      return res.status(500).json({ message: "센서 이력 조회 실패" });
    }

    res.json(filterRowsByRegion(req, rows, "bin_loc"));
  });
});

module.exports = router;


















