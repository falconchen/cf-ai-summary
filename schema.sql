CREATE TABLE IF NOT EXISTS blog_summary (
  id TEXT PRIMARY KEY,
  content TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS counter (
  url TEXT PRIMARY KEY,
  counter INTEGER
);
