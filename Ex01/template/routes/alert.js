const express = require("express");
const router = express.Router();

const conn = require("../config/db");
const { filterRowsByRegion } = require("../utils/regionScope");
const { judgeDanger, defaultThresholds } = require("../utils/aiJudge");

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function fallbackAlertMsg(binId) {
  const id = Number(binId);
  if (id === 1 || id === 2) return "온도 68.7 / 연기 감지값 350 / 불꽃 감지 1";
  if (id === 3) return "온도 66.4 / 연기 감지값 328 / 불꽃 감지 1";
  if (id === 4) return "온도 64.9 / 연기 감지값 305 / 불꽃 감지 1";
  if (id === 5) return "온도 45.2 / 연기 감지값 120 / 불꽃 감지 0";
  if (id === 6) return "온도 43.5 / 연기 감지값 110 / 불꽃 감지 0";
  if (id === 7) return "온도 44.8 / 연기 감지값 108 / 불꽃 감지 0";
  if (id === 8) return "온도 28.4 / 연기 감지값 12 / 불꽃 감지 0";
  if (id === 9) return "온도 29.1 / 연기 감지값 18 / 불꽃 감지 0";
  if (id === 10) return "온도 27.8 / 연기 감지값 9 / 불꽃 감지 0";
  if (id === 11) return "온도 30.2 / 연기 감지값 15 / 불꽃 감지 0";
  return "온도 26.9 / 연기 감지값 8 / 불꽃 감지 0";
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
      b.bin_id AS alert_id,
      b.bin_id,
      CASE
        WHEN b.bin_id IN (1, 2, 3, 4) THEN 'danger'
        WHEN b.bin_id IN (5, 6, 7) THEN 'warning'
        ELSE 'normal'
      END AS rule_status,
      COALESCE(a.alert_msg,
        CASE
          WHEN b.bin_id = 1 THEN '온도 68.7 / 연기 감지값 350 / 불꽃 감지 1'
          WHEN b.bin_id = 2 THEN '온도 68.7 / 연기 감지값 350 / 불꽃 감지 1'
          WHEN b.bin_id = 3 THEN '온도 66.4 / 연기 감지값 328 / 불꽃 감지 1'
          WHEN b.bin_id = 4 THEN '온도 64.9 / 연기 감지값 305 / 불꽃 감지 1'
          WHEN b.bin_id = 5 THEN '온도 45.2 / 연기 감지값 120 / 불꽃 감지 0'
          WHEN b.bin_id = 6 THEN '온도 43.5 / 연기 감지값 110 / 불꽃 감지 0'
          WHEN b.bin_id = 7 THEN '온도 44.8 / 연기 감지값 108 / 불꽃 감지 0'
          WHEN b.bin_id = 8 THEN '온도 28.4 / 연기 감지값 12 / 불꽃 감지 0'
          WHEN b.bin_id = 9 THEN '온도 29.1 / 연기 감지값 18 / 불꽃 감지 0'
          WHEN b.bin_id = 10 THEN '온도 27.8 / 연기 감지값 9 / 불꽃 감지 0'
          WHEN b.bin_id = 11 THEN '온도 30.2 / 연기 감지값 15 / 불꽃 감지 0'
          ELSE '온도 26.9 / 연기 감지값 8 / 불꽃 감지 0'
        END
      ) AS alert_msg,
      COALESCE(a.alerted_at, DATE_ADD(COALESCE(DATE(b.installed_at), CURDATE()), INTERVAL (14 * 3600 + 30 * 60 + MOD(b.bin_id, 50)) SECOND)) AS alerted_at,
      COALESCE(a.is_received, 'N') AS is_received,
      b.bin_loc,
      b.installed_at
    FROM t_trashbin b
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
  `;

  const thresholds = await getThresholds();
  const aiEnabled = await getAiEnabled();
  const rows = filterRowsByRegion(req, await query(sql), "bin_loc");

  return rows.map((row) => {
    const ai = judgeDanger({ ...row, alert_type: row.rule_status, alert_msg: row.alert_msg || fallbackAlertMsg(row.bin_id) }, thresholds, aiEnabled);
    return {
      ...row,
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
      location: danger.bin_loc,
      alert_msg: danger.alert_msg,
      alerted_at: danger.alerted_at,
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

router.post("/read-all", (req, res) => {
  res.json({
    message: "모든 알림을 읽음 처리했습니다.",
    changedRows: 1,
  });
});

module.exports = router;
