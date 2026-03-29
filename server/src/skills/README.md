# Agent Skills

This folder contains one file per agent tool/skill loaded dynamically by `backend/src/SkillRegistry.js`.
Each skill file includes:

- tool description
- input schema
- execution snippet (how the tool is called from the agent loop)

Runtime skill modules are discovered automatically from files matching `*.skill.js`.
You can override discovery path with `SKILLS_DIR` (relative to backend process cwd).

## Files

- `think.md`
- `file_search.md`
- `file_read.md`
- `file_write.md`
- `shell_exec.md`
- `web_fetch.md`
- `task_done.md`
- `think.skill.js`
- `file_search.skill.js`
- `file_read.skill.js`
- `file_write.skill.js`
- `shell_exec.skill.js`
- `web_fetch.skill.js`
- `task_done.skill.js`
