const express = require("express");
const router = express.Router();

const conn = require("../config/db");
const { filterRowsByRegion, dedupeRowsByLocation, buildLocationWhere } = require("../utils/regionScope");
const { judgeDanger, defaultThresholds } = require("../utils/aiJudge");

function displayBinId(binId) {
  return binId;
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}


async function getThresholds() {
  try {
    const rows = await query("SELECT danger_temp, warning_temp, danger_smoke, warning_smoke FROM t_fire_threshold WHERE id = 1");
    const row = rows && rows[0];
    if (!row) return defaultThresholds;
    return {
      dangerTemp: Number(row.danger_temp),
      warningTemp: Number(row.warning_temp),
      dangerSmoke: Number(row.danger_smoke),
      warningSmoke: Number(row.warning_smoke),
    };
  } catch (err) {
    return defaultThresholds;
  }
}

async function getAiEnabled() {
  try {
    const rows = await query("SELECT setting_value FROM t_system_setting WHERE setting_key = 'aiJudge'");
    return rows && rows[0] ? rows[0].setting_value !== "N" : true;
  } catch (err) {
    return true;
  }
}

async function getScopedAlerts(req) {
  const sql = `
    SELECT
      COALESCE(a.alert_id, b.bin_id) AS alert_id,
      b.bin_id,
      CASE
        WHEN s.fire_risk = 2 THEN 'danger'
        WHEN s.fire_risk = 1 THEN 'warning'
        WHEN a.alert_type IS NOT NULL THEN a.alert_type
        ELSE 'normal'
      END AS rule_status,
      COALESCE(a.alert_msg, '') AS alert_msg,
      COALESCE(a.alerted_at, s.created_at, b.created_at) AS alerted_at,
      COALESCE(a.is_received, 'N') AS is_received,
      b.bin_loc,
      b.installed_at,
      s.temp AS temp_value,
      s.gas AS smoke_value,
      s.flame AS flame_value,
      s.fire_risk
    FROM t_trashbin b
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
    ) a ON b.bin_id = a.bin_id
    WHERE IFNULL(b.network_status, 1) <> 9
  `

  const thresholds = await getThresholds();
  const aiEnabled = await getAiEnabled();
  const rows = dedupeRowsByLocation(filterRowsByRegion(req, await query(sql), "bin_loc"), "bin_loc");

  return rows.map((row) => {
    const ai = judgeDanger({ ...row, alert_type: row.rule_status, alert_msg: row.alert_msg || "" }, thresholds, aiEnabled);
    return {
      ...row,
      display_bin_id: displayBinId(row.bin_id),
      alert_type: ai.status,
      ai_enabled: aiEnabled ? "Y" : "N",
      temp_value: ai.sensor.temp,
      smoke_value: ai.sensor.smoke,
      flame_value: ai.sensor.flame,
    };
  }).sort((a, b) => {
    const rank = (type) => type === "danger" ? 1 : type === "warning" ? 2 : 3;
    return rank(a.alert_type) - rank(b.alert_type) || new Date(b.alerted_at) - new Date(a.alerted_at) || Number(a.bin_id) - Number(b.bin_id);
  });
}

router.get("/danger/latest", async (req, res) => {
  try {
    const danger = (await getScopedAlerts(req)).find((row) => row.alert_type === "danger");
    if (!danger) return res.json({ hasDanger: false });

    res.json({
      hasDanger: true,
      alert_id: danger.alert_id,
      bin_id: danger.bin_id,
      display_bin_id: displayBinId(danger.bin_id),
      location: danger.bin_loc,
      alert_msg: danger.alert_msg,
      alerted_at: danger.alerted_at,
      temp_value: danger.temp_value,
      smoke_value: danger.smoke_value,
      flame_value: danger.flame_value,
    });
  } catch (err) {
    console.error("위험 알림 조회 실패:", err);
    res.status(500).json({ hasDanger: false, message: "위험 알림 조회 실패" });
  }
});

router.get("/list", async (req, res) => {
  try {
    res.json(await getScopedAlerts(req));
  } catch (err) {
    console.error("알림 목록 조회 실패:", err);
    res.status(500).json({ message: "알림 목록 조회 실패" });
  }
});

router.post("/read-all", async (req, res) => {
  try {
    const scope = buildLocationWhere(req, "b.bin_loc");
    const result = await query(`
      UPDATE t_alert a
      LEFT JOIN t_trashbin b ON a.bin_id = b.bin_id
      SET
        a.is_received = 'Y',
        a.received_at = CASE
          WHEN a.is_received = 'Y' THEN a.received_at
          ELSE NOW()
        END
      WHERE a.is_received <> 'Y'
        AND a.alert_type <> 'normal'
        AND (b.network_status IS NULL OR b.network_status <> 9)
        ${scope.clause}
    `, scope.params);

    res.json({
      message: "모든 알림을 읽음 처리했습니다.",
      changedRows: result.changedRows || 0,
    });
  } catch (err) {
    console.error("상단 알림 전체 읽음 처리 실패:", err);
    res.status(500).json({ message: "모든 알림 읽음 처리 실패" });
  }
});

module.exports = router;





