const express = require("express");
const router = express.Router();

const conn = require("../config/db");


router.get("/danger/latest", (req, res) => {
  const sql = `
    SELECT
      b.bin_id,
      b.bin_loc,
      '온도 68.7 / 연기 감지값 350 / 불꽃 감지 1' AS alert_msg,
      NOW() AS alerted_at
    FROM t_trashbin b
    WHERE b.bin_id IN (1, 2, 3, 4)
    ORDER BY b.bin_id ASC
    LIMIT 1
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("위험 알림 조회 실패:", err);
      return res.status(500).json({ hasDanger: false, message: "위험 알림 조회 실패" });
    }

    if (!rows.length) return res.json({ hasDanger: false });

    const alert = rows[0];
    res.json({
      hasDanger: true,
      alert_id: alert.bin_id,
      bin_id: alert.bin_id,
      location: alert.bin_loc,
      alert_msg: alert.alert_msg,
      alerted_at: alert.alerted_at,
    });
  });
});

router.get("/list", (req, res) => {
  const sql = `
    SELECT
      b.bin_id AS alert_id,
      b.bin_id,
      CASE
        WHEN b.bin_id IN (1, 2, 3, 4) THEN 'danger'
        WHEN b.bin_id IN (5, 6, 7) THEN 'warning'
        ELSE 'normal'
      END AS alert_type,
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
      END AS alert_msg,
      DATE_ADD(COALESCE(DATE(b.installed_at), CURDATE()), INTERVAL (14 * 3600 + 30 * 60 + MOD(b.bin_id, 50)) SECOND) AS alerted_at,
      'N' AS is_received,
      b.bin_loc,
      b.installed_at
    FROM t_trashbin b
    ORDER BY
      CASE
        WHEN b.bin_id IN (1, 2, 3, 4) THEN 1
        WHEN b.bin_id IN (5, 6, 7) THEN 2
        ELSE 3
      END,
      b.bin_id ASC
    LIMIT 20
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("알림 목록 조회 실패:", err);
      return res.status(500).json({ message: "알림 목록 조회 실패" });
    }

    res.json(rows);
  });
});

router.post("/read-all", (req, res) => {
  res.json({
    message: "\uBAA8\uB4E0 \uC54C\uB9BC\uC744 \uC77D\uC74C \uCC98\uB9AC\uD588\uC2B5\uB2C8\uB2E4.",
    changedRows: 1,
  });
});

module.exports = router;

