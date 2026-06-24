const express = require("express");
const router = express.Router();

const conn = require("../config/db");

router.get("/danger/latest", (req, res) => {
  const sql = `
    SELECT
      b.bin_id,
      b.bin_loc,
      '화재 위험 감지 - 즉각 대응 필요' AS alert_msg,
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
        WHEN b.bin_id IN (1, 2, 3, 4) THEN '화재 위험 감지 - 즉각 대응 필요'
        WHEN b.bin_id IN (5, 6, 7) THEN '온도 및 연기 임계값 초과'
        ELSE '센서 상태 정상으로 복귀'
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
    message: "테스트 모드에서는 새로고침 시 다시 안읽음 상태로 표시됩니다.",
    changedRows: 0,
  });
});

module.exports = router;

