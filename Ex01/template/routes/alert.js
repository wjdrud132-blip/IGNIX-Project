const express = require("express");
const router = express.Router();

const conn = require("../config/db");

router.get("/danger/latest", (req, res) => {
  const sql = `
    SELECT
      a.alert_id,
      a.bin_id,
      a.alert_type,
      a.alert_msg,
      a.alerted_at,
      a.is_received,
      b.bin_loc
    FROM t_alert a
    JOIN t_trashbin b
      ON a.bin_id = b.bin_id
    WHERE a.alert_type = 'danger'
      AND a.is_received = 'N'
    ORDER BY a.alerted_at DESC
    LIMIT 1
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("?꾪뿕 ?뚮┝ 議고쉶 ?ㅽ뙣:", err);

      return res.status(500).json({
        hasDanger: false,
        message: "?꾪뿕 ?뚮┝ 議고쉶 ?ㅽ뙣",
      });
    }

    if (rows.length === 0) {
      return res.json({
        hasDanger: false,
      });
    }

    const alert = rows[0];

    res.json({
      hasDanger: true,
      alert_id: alert.alert_id,
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
      a.alert_id,
      a.bin_id,
      a.alert_type,
      a.alert_msg,
      a.alerted_at,
      a.is_received,
      b.bin_loc
    FROM t_alert a
    JOIN t_trashbin b
      ON a.bin_id = b.bin_id
    ORDER BY
      CASE
        WHEN a.alert_type = 'danger' THEN 1
        WHEN a.alert_type = 'warning' THEN 2
        WHEN a.alert_type = 'normal' THEN 3
        ELSE 4
      END,
      a.bin_id ASC,
      a.alerted_at DESC
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
  const sql = `
    UPDATE t_alert
    SET is_received = 'Y',
        received_at = NOW()
    WHERE is_received = 'N'
  `;

  conn.query(sql, (err, result) => {
    if (err) {
      console.error("알림 모두 읽음 처리 실패:", err);
      return res.status(500).json({ message: "알림 모두 읽음 처리 실패" });
    }

    res.json({
      message: "모든 알림을 읽음 처리했습니다.",
      changedRows: result.changedRows,
    });
  });
});
module.exports = router;



