const conn = require("../config/db");

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

async function getLogs() {
  const sql = `
    SELECT
      a.alert_id,
      a.bin_id,
      a.alert_type,
      a.alert_msg,
      a.alerted_at,
      a.is_received,
      a.received_at,
      b.bin_loc,
      b.installed_at
    FROM t_alert a
    LEFT JOIN t_trashbin b
      ON a.bin_id = b.bin_id
    ORDER BY
      CASE
        WHEN a.alert_type = 'danger' THEN 1
        WHEN a.alert_type = 'warning' THEN 2
        WHEN a.alert_type = 'normal' THEN 3
        ELSE 4
      END,
      a.alerted_at DESC,
      a.alert_id DESC
  `;

  return await query(sql);
}

async function getStats() {
  const sql = `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN alert_type = 'danger' THEN 1 ELSE 0 END) AS danger,
      SUM(CASE WHEN alert_type = 'warning' THEN 1 ELSE 0 END) AS warning,
      SUM(CASE WHEN alert_type = 'normal' THEN 1 ELSE 0 END) AS normal
    FROM t_alert
  `;

  const rows = await query(sql);
  const row = rows[0] || {};

  return {
    total: Number(row.total || 0),
    danger: Number(row.danger || 0),
    warning: Number(row.warning || 0),
    normal: Number(row.normal || 0)
  };
}

async function markAllRead() {
  const sql = `
    UPDATE t_alert
    SET is_received = 'Y',
        received_at = NOW()
    WHERE is_received = 'N'
  `;

  const result = await query(sql);

  return {
    changedRows: result.changedRows || 0
  };
}

module.exports = {
  getLogs,
  getStats,
  markAllRead
};