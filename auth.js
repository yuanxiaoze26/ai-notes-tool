const bcrypt = require('bcryptjs');
const { getDb } = require('./database');

// 注册用户
async function registerUser(username, email, password) {
  return new Promise((resolve, reject) => {
    const db = getDb();

    // 哈希密码
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        reject(err);
        return;
      }

      const stmt = db.prepare(
        'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
      );

      stmt.run([username, email, hash], function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            reject(new Error('用户名或邮箱已存在'));
          } else {
            reject(err);
          }
        } else {
          resolve({
            id: this.lastID,
            username,
            email
          });
        }
      });

      stmt.finalize();
    });
  });
}

// 用户登录
async function loginUser(username, password) {
  return new Promise((resolve, reject) => {
    const db = getDb();

    db.get(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, username],
      (err, user) => {
        if (err) {
          reject(err);
          return;
        }

        if (!user) {
          reject(new Error('用户不存在'));
          return;
        }

        // 验证密码
        bcrypt.compare(password, user.password, (err, isMatch) => {
          if (err) {
            reject(err);
            return;
          }

          if (!isMatch) {
            reject(new Error('密码错误'));
            return;
          }

          // 更新最后登录时间
          db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
          );

          // 返回用户信息（不含密码）
          const { password: _, ...userInfo } = user;
          resolve(userInfo);
        });
      }
    );
  });
}

// 根据ID获取用户
async function getUserById(userId) {
  return new Promise((resolve, reject) => {
    const db = getDb();

    db.get(
      'SELECT id, username, email, created_at, last_login FROM users WHERE id = ?',
      [userId],
      (err, user) => {
        if (err) reject(err);
        else resolve(user);
      }
    );
  });
}

module.exports = {
  registerUser,
  loginUser,
  getUserById
};
