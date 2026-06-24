const express = require("express");
const router = express.Router();
const conn = require("../config/db");

const emailCodes = {};

function ensureManagerOrgColumn(callback) {
  conn.query("ALTER TABLE t_manager ADD COLUMN mgr_org VARCHAR(100) NULL", (err) => {
    if (err && err.code !== "ER_DUP_FIELDNAME") return callback(err);
    callback(null);
  });
}

router.post("/email/send", (req, res) => {
  const { mgr_email } = req.body;

  if (!mgr_email) {
    return res.send("이메일을 입력해주세요.");
  }

  const email = mgr_email.trim();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  emailCodes[email] = code;

  console.log("이메일:", email);
  console.log("인증번호:", code);

  res.send("인증번호가 발송되었습니다.");
});

router.post("/email/check", (req, res) => {
  const { mgr_email, code } = req.body;

  if (!mgr_email || !code) {
    return res.send("이메일과 인증번호를 입력해주세요.");
  }

  const email = mgr_email.trim();
  const inputCode = String(code).trim();

  if (emailCodes[email] === inputCode) {
    return res.send("이메일 인증 성공");
  }

  res.send("인증번호가 일치하지 않습니다.");
});

router.get("/test", (req, res) => {
  res.send("manager router 연결 성공");
});

router.post("/join", (req, res) => {
  const { mgr_email, mgr_pw, mgr_name, mgr_phone, mgr_org } = req.body;

  if (!mgr_email || !mgr_pw || !mgr_name) {
    return res.send("필수 회원정보가 누락되었습니다.");
  }

  const email = mgr_email.trim();
  const password = mgr_pw.trim();
  const name = mgr_name.trim();
  const phone = mgr_phone ? mgr_phone.trim() : "";
  const org = mgr_org ? mgr_org.trim() : "";

  const sql = `
    INSERT INTO t_manager
    (mgr_email, mgr_pw, mgr_name, mgr_phone, mgr_org, is_approved, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  ensureManagerOrgColumn((columnErr) => {
    if (columnErr) {
      console.error("소속기관 컬럼 확인 실패:", columnErr);
      return res.send("회원가입 신청 실패");
    }

    conn.query(sql, [email, password, name, phone, org, 0, "manager"], (err) => {
      if (err) {
        console.error("회원가입 신청 실패:", err);

        if (err.code === "ER_DUP_ENTRY") {
          return res.send("이미 가입된 이메일입니다.");
        }

        return res.send("회원가입 신청 실패");
      }

      res.send("회원가입 신청 완료");
    });
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

router.post("/login", (req, res) => {
  const { mgr_email, mgr_pw } = req.body;

  if (!mgr_email || !mgr_pw) {
    return res.json({ success: false, message: "이메일과 비밀번호를 입력해주세요." });
  }

  ensureManagerOrgColumn((columnErr) => {
    if (columnErr) {
      console.error("소속기관 컬럼 확인 실패:", columnErr);
      return res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
    }

    const sql = `
      SELECT mgr_id, mgr_email, mgr_pw, mgr_name, mgr_org, is_approved, role
      FROM t_manager
      WHERE mgr_email = ?
    `;

    conn.query(sql, [mgr_email], (err, rows) => {
      if (err) {
        console.error("로그인 조회 실패:", err);
        return res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
      }

      if (rows.length === 0) {
        return res.json({ success: false, message: "존재하지 않는 계정입니다." });
      }

      const user = rows[0];

      if (user.mgr_pw !== mgr_pw) {
        return res.json({ success: false, message: "비밀번호가 일치하지 않습니다." });
      }

      if (user.role !== "operator" && user.is_approved === 0) {
        return res.json({ success: false, message: "관리자 승인 대기 중입니다." });
      }

      req.session.user = {
        user_id: user.mgr_id,
        email: user.mgr_email,
        role: user.role,
        approval_status: user.is_approved,
      };

      return res.json({
        success: true,
        message: user.role === "operator" ? "운영자 로그인 성공" : "로그인 성공",
        role: user.role,
        redirect: user.role === "operator" ? "/admin/approval" : "/dashboard",
        user: {
          mgr_id: user.mgr_id,
          mgr_email: user.mgr_email,
          mgr_name: user.mgr_name,
          mgr_org: user.mgr_org,
        },
      });
    });
  });
});

module.exports = router;