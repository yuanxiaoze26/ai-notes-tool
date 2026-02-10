const express = require('express');
const marked = require('marked');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

const { initDatabase, getDb } = require('./database');
const { registerUser, loginUser, getUserById } = require('./auth');

const app = express();
const PORT = process.env.PORT || 80;

// 初始化数据库
let db;
async function startServer() {
  try {
    db = await initDatabase();
    console.log('✅ Database initialized');
    app.listen(PORT, () => {
      console.log(`🚀 OpenMD server running on port ${PORT}`);
      console.log(`📝 API: http://localhost:${PORT}/api/notes`);
      console.log(`🌐 Web: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// 中间件
app.use(cors());
app.use(express.json());
app.use(session({
  secret: 'openmd-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7天
}));

// 检查登录状态
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

// ============ 用户相关 API ============

// 注册
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }

    const user = await registerUser(username, email, password);
    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: error.message || '注册失败' });
  }
});

// 登录
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const user = await loginUser(username, password);
    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ error: error.message || '登录失败' });
  }
});

// 登出
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 获取当前用户
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.session.userId);
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// ============ 笔记相关 API ============

// 创建笔记
app.post('/api/notes', async (req, res) => {
  try {
    const { title, content, metadata = {} } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const userId = req.session.userId || null;
    const metadataStr = JSON.stringify(metadata);

    const db = getDb();
    const stmt = db.prepare(
      'INSERT INTO notes (user_id, title, content, metadata) VALUES (?, ?, ?, ?)'
    );

    stmt.run([userId, title || 'Untitled', content, metadataStr], function(err) {
      if (err) {
        console.error('Error creating note:', err);
        return res.status(500).json({ error: '创建笔记失败' });
      }

      res.json({
        id: this.lastID,
        title: title || 'Untitled',
        content,
        metadata,
        userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    stmt.finalize();
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取笔记
app.get('/api/notes/:id', async (req, res) => {
  try {
    const db = getDb();
    db.get(
      'SELECT * FROM notes WHERE id = ?',
      [req.params.id],
      (err, note) => {
        if (err) {
          console.error('Error fetching note:', err);
          return res.status(500).json({ error: '获取笔记失败' });
        }

        if (!note) {
          return res.status(404).json({ error: 'Note not found' });
        }

        // 解析 metadata
        note.metadata = note.metadata ? JSON.parse(note.metadata) : {};

        res.json(note);
      }
    );
  } catch (error) {
    console.error('Error fetching note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 更新笔记
app.put('/api/notes/:id', async (req, res) => {
  try {
    const { title, content, metadata } = req.body;
    const db = getDb();

    db.get('SELECT * FROM notes WHERE id = ?', [req.params.id], (err, note) => {
      if (err) {
        return res.status(500).json({ error: '更新笔记失败' });
      }

      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }

      // 如果有用户，检查权限
      if (note.user_id && req.session.userId !== note.user_id) {
        return res.status(403).json({ error: '无权修改此笔记' });
      }

      const updates = [];
      const values = [];

      if (title !== undefined) {
        updates.push('title = ?');
        values.push(title);
      }
      if (content !== undefined) {
        updates.push('content = ?');
        values.push(content);
      }
      if (metadata !== undefined) {
        updates.push('metadata = ?');
        values.push(JSON.stringify(metadata));
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.params.id);

      db.run(
        `UPDATE notes SET ${updates.join(', ')} WHERE id = ?`,
        values,
        function(err) {
          if (err) {
            return res.status(500).json({ error: '更新失败' });
          }

          res.json({ success: true });
        }
      );
    });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 列出所有笔记
app.get('/api/notes', async (req, res) => {
  try {
    const db = getDb();

    db.all(
      'SELECT * FROM notes ORDER BY updated_at DESC LIMIT 100',
      [],
      (err, rows) => {
        if (err) {
          console.error('Error listing notes:', err);
          return res.status(500).json({ error: '获取笔记列表失败' });
        }

        // 解析 metadata
        const notes = rows.map(note => ({
          ...note,
          metadata: note.metadata ? JSON.parse(note.metadata) : {}
        }));

        res.json(notes);
      }
    );
  } catch (error) {
    console.error('Error listing notes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 删除笔记
app.delete('/api/notes/:id', async (req, res) => {
  try {
    const db = getDb();
    db.run('DELETE FROM notes WHERE id = ?', [req.params.id], function(err) {
      if (err) {
        console.error('Error deleting note:', err);
        return res.status(500).json({ error: '删除失败' });
      }

      res.json({ success: true });
    });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 列出所有用户
app.get('/api/users', async (req, res) => {
  try {
    const db = getDb();
    db.all(
      'SELECT id, username, email, created_at, last_login FROM users ORDER BY created_at DESC',
      [],
      (err, rows) => {
        if (err) {
          console.error('Error listing users:', err);
          return res.status(500).json({ error: '获取用户列表失败' });
        }

        res.json(rows);
      }
    );
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ 页面路由 ============

// 后台管理
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 查看笔记
app.get('/note/:id', async (req, res) => {
  try {
    const db = getDb();
    db.get(
      'SELECT * FROM notes WHERE id = ?',
      [req.params.id],
      (err, note) => {
        if (err) {
          console.error('Error rendering note:', err);
          return res.status(500).send('Error rendering note');
        }

        if (!note) {
          return res.status(404).send('Note not found');
        }

        const metadata = note.metadata ? JSON.parse(note.metadata) : {};
        const htmlContent = marked.parse(note.content);

        res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${note.title} - OpenMD</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
      margin-bottom: 20px;
      color: #2c3e50;
    }
    .metadata {
      font-size: 0.85em;
      color: #666;
      margin-bottom: 20px;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 4px;
    }
    .markdown {
      line-height: 1.8;
    }
    .markdown h2 {
      margin-top: 30px;
      margin-bottom: 15px;
      color: #2c3e50;
    }
    .markdown p {
      margin-bottom: 15px;
    }
    .markdown code {
      background: #f0f4f8 !important;
      color: #2c3e50 !important;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    .markdown pre {
      background: #f0f4f8;
      color: #2c3e50;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
      margin-bottom: 20px;
      border: 1px solid #e0e6ed;
    }
    .markdown pre code {
      background: transparent !important;
      color: #2c3e50 !important;
      padding: 0;
    }
    .markdown blockquote {
      border-left: 4px solid #3498db;
      padding-left: 15px;
      margin: 20px 0;
      color: #555;
      font-style: italic;
    }
    .markdown ul, .markdown ol {
      margin-bottom: 15px;
      padding-left: 30px;
    }
    .markdown li {
      margin-bottom: 8px;
    }
    .markdown a {
      color: #3498db;
      text-decoration: none;
    }
    .markdown a:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      color: #888;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${note.title}</h1>
    <div class="metadata">
      <p>Created: ${new Date(note.created_at).toLocaleString('zh-CN')}</p>
      <p>Last Updated: ${new Date(note.updated_at).toLocaleString('zh-CN')}</p>
      ${Object.entries(metadata || {}).map(([k, v]) => `<p>${k}: ${v}</p>`).join('')}
    </div>
    <div class="markdown">
      ${htmlContent}
    </div>
    <div class="footer">
      <p>🤖 Generated by OpenMD - AI-native note tool</p>
    </div>
  </div>
</body>
</html>
        `);
      }
    );
  } catch (error) {
    console.error('Error rendering note:', error);
    res.status(500).send('Error rendering note');
  }
});

// 首页
app.get('/', (req, res) => {
  const db = getDb();

  db.all('SELECT * FROM notes ORDER BY updated_at DESC LIMIT 10', [], (err, notes) => {
    const allNotes = notes.map(note => ({
      ...note,
      metadata: note.metadata ? JSON.parse(note.metadata) : {}
    }));

    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenMD - AI-native Note Tool</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f8f9fa;
      min-height: 100vh;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 60px;
      padding: 60px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 16px;
      color: white;
      box-shadow: 0 10px 40px rgba(102, 126, 234, 0.3);
    }
    .header h1 {
      font-size: 3rem;
      margin-bottom: 16px;
      font-weight: 700;
    }
    .header .tagline {
      font-size: 1.25rem;
      opacity: 0.95;
      margin-bottom: 20px;
    }
    .header .stats {
      display: inline-flex;
      gap: 30px;
      background: rgba(255,255,255,0.1);
      padding: 12px 24px;
      border-radius: 30px;
      backdrop-filter: blur(10px);
    }
    .stat {
      text-align: center;
    }
    .stat-number {
      font-size: 2rem;
      font-weight: 700;
      display: block;
    }
    .stat-label {
      font-size: 0.875rem;
      opacity: 0.9;
    }
    .section {
      background: white;
      border-radius: 12px;
      padding: 40px;
      margin-bottom: 30px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .section-title {
      font-size: 1.75rem;
      color: #2c3e50;
      margin-bottom: 30px;
      padding-bottom: 15px;
      border-bottom: 3px solid #667eea;
    }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 25px;
      margin-bottom: 40px;
    }
    .feature-card {
      background: #f8f9fa;
      padding: 25px;
      border-radius: 10px;
      border-left: 4px solid #667eea;
    }
    .feature-icon {
      font-size: 2rem;
      margin-bottom: 12px;
    }
    .feature-title {
      font-weight: 600;
      color: #2c3e50;
      margin-bottom: 8px;
      font-size: 1.1rem;
    }
    .feature-desc {
      color: #666;
      font-size: 0.95rem;
    }
    .api-section {
      background: #f8f9fa;
      padding: 25px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .api-method {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 0.85rem;
      margin-right: 10px;
    }
    .method-post { background: #22c55e; color: white; }
    .method-get { background: #3b82f6; color: white; }
    .method-put { background: #f59e0b; color: white; }
    code {
      background: #e9ecef;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.9em;
    }
    pre {
      background: #f0f4f8;
      color: #2c3e50;
      padding: 20px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 15px 0;
      font-size: 0.9em;
      line-height: 1.5;
      border: 1px solid #e0e6ed;
    }
    .notes-list {
      display: grid;
      gap: 20px;
    }
    .note-card {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 25px;
      transition: all 0.3s ease;
      cursor: pointer;
    }
    .note-card:hover {
      border-color: #667eea;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
      transform: translateY(-2px);
    }
    .note-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: #2c3e50;
      margin-bottom: 10px;
    }
    .note-meta {
      color: #666;
      font-size: 0.875rem;
      display: flex;
      gap: 20px;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #888;
    }
    .empty-icon {
      font-size: 4rem;
      margin-bottom: 20px;
      opacity: 0.5;
    }
    .footer {
      text-align: center;
      padding: 40px;
      color: #666;
      font-size: 0.9em;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 OpenMD</h1>
      <p class="tagline">AI-native note tool - Designed for Agents, read by humans</p>
      <div class="stats">
        <div class="stat">
          <span class="stat-number">${allNotes.length}</span>
          <span class="stat-label">笔记总数</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">✨ 核心特性</h2>
      <div class="features">
        <div class="feature-card">
          <div class="feature-icon">🤖</div>
          <div class="feature-title">Agent 优先</div>
          <div class="feature-desc">专为 AI Agent 设计的 API，支持自动化内容创建和管理</div>
        </div>
        <div class="feature-card">
          <div class="feature-icon">📝</div>
          <div class="feature-title">Markdown 原生</div>
          <div class="feature-desc">完全支持 Markdown 格式，保留格式和结构</div>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔗</div>
          <div class="feature-title">一键分享</div>
          <div class="feature-desc">通过简单的 URL 分享笔记，无需登录即可浏览</div>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🎨</div>
          <div class="feature-title">精美渲染</div>
          <div class="feature-desc">自动渲染为美观的 HTML，提供优秀的阅读体验</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">📋 最近的笔记</h2>
      ${allNotes.length > 0 ? `
        <div class="notes-list">
          ${allNotes.map(note => `
            <a href="/note/${note.id}" class="note-card">
              <div class="note-title">${note.title}</div>
              <div class="note-meta">
                <span>📅 ${new Date(note.created_at).toLocaleDateString('zh-CN')}</span>
                <span>✏️ ${note.metadata.author || 'Anonymous'}</span>
              </div>
            </a>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>暂无笔记，开始创建你的第一条笔记吧！</p>
        </div>
      `}
    </div>

    <div class="footer">
      <p>🚀 Powered by <strong>OpenMD</strong> - Open source on <a href="https://github.com/yuanxiaoze26/openmd" target="_blank">GitHub</a></p>
    </div>
  </div>
</body>
</html>
    `);
  });
});

// 启动服务器
startServer();
