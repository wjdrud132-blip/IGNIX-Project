const express = require("express");
const router = express.Router();

const conn = require("../config/db");
const requireOperator = require("../middlewares/requireOperator");

router.get("/managers", requireOperator, (req, res) => {
  const sql = `
    SELECT mgr_id, mgr_email, mgr_name, mgr_phone, is_approved, joined_at
    FROM t_manager
    WHERE is_approved = 0
      AND role = 'manager'
    ORDER BY joined_at DESC
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("pending manager list failed:", err);
      return res.status(500).json({ message: "승인 대기 목록 조회 실패" });
    }

    res.json(rows);
  });
});

router.get("/managers/approved", requireOperator, (req, res) => {
  const sql = `
    SELECT mgr_id, mgr_email, mgr_name, mgr_phone, is_approved, joined_at
    FROM t_manager
    WHERE is_approved = 1
      AND role = 'manager'
    ORDER BY joined_at DESC
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("approved manager list failed:", err);
      return res.status(500).json({ message: "승인 완료 목록 조회 실패" });
    }

    res.json(rows);
  });
});

router.post("/managers/approve", requireOperator, (req, res) => {
  const { mgr_id } = req.body;

  if (!mgr_id) {
    return res.status(400).json({ message: "관리자 ID가 필요합니다." });
  }

  const sql = `
    UPDATE t_manager
    SET is_approved = 1
    WHERE mgr_id = ?
      AND role = 'manager'
  `;

  conn.query(sql, [mgr_id], (err, result) => {
    if (err) {
      console.error("manager approve failed:", err);
      return res.status(500).json({ message: "관리자 승인 실패" });
    }

    res.json({ message: "관리자 승인이 완료되었습니다." });
  });
});

router.post("/managers/reject", requireOperator, (req, res) => {
  const { mgr_id } = req.body;

  if (!mgr_id) {
    return res.status(400).json({ message: "관리자 ID가 필요합니다." });
  }

  const sql = `
    DELETE FROM t_manager
    WHERE mgr_id = ?
      AND role = 'manager'
      AND is_approved = 0
  `;

  conn.query(sql, [mgr_id], (err, result) => {
    if (err) {
      console.error("manager reject failed:", err);
      return res.status(500).json({ message: "관리자 거절 실패" });
    }

    res.json({ message: "관리자 가입 요청을 거절했습니다." });
  });
});

module.exports = router;
