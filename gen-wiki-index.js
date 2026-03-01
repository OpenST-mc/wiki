const fs = require('fs');
const path = require('path');

const WIKI_DIR = path.join(__dirname, 'wiki_content');
const OUTPUT_PATH = path.join(__dirname, 'public/wiki.json');
const ARCHIVE_EPOCH = new Date('2000-01-01T00:00:00Z').getTime();

function scan() {
    if (!fs.existsSync(WIKI_DIR)) return;

    const folders = fs.readdirSync(WIKI_DIR);
    const index = folders.map(folder => {
        const folderPath = path.join(WIKI_DIR, folder);
        if (!fs.statSync(folderPath).isDirectory()) return null;

        const files = fs.readdirSync(folderPath);
        const mdName = files.find(f => f.endsWith('.md'));
        if (!mdName) return null;

        const filePath = path.join(folderPath, mdName);
        let raw = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);

        // 1. 尝试匹配元数据
        let metaMatch = raw.match(/^===\s*([\s\S]*?)\s*===/);
        let meta = {};
        if (metaMatch) {
            metaMatch[1].split('\n').forEach(line => {
                const [key, ...val] = line.split(/[:：]/);
                if (key && val.length) meta[key.trim()] = val.join(':').trim();
            });
        }

        // 2. 核心：ID 自动生成与固化逻辑
        let finalId = meta['id'] || meta['文章id'];
        if (!finalId) {
            // 生成千禧秒数 ID
            const secondsSince2000 = Math.floor((stats.birthtimeMs - ARCHIVE_EPOCH) / 1000);
            finalId = `wiki-${secondsSince2000}`;

            // 💡 自动写回：如果没有头部，则新建；如果有，则插入 id
            if (metaMatch) {
                const newHeader = `===\nid: ${finalId}\n${metaMatch[1].trim()}\n===`;
                raw = raw.replace(/^===\s*([\s\S]*?)\s*===/, newHeader);
            } else {
                raw = `===\nid: ${finalId}\n标题: ${folder}\n===\n\n${raw}`;
            }
            fs.writeFileSync(filePath, raw, 'utf-8');
            console.log(`✨ 为档案 [${folder}] 固化了新 ID: ${finalId}`);
        }

        return {
            id: finalId,
            title: meta['标题'] || folder,
            summary: meta['简介'] || '档案馆未记录摘要...',
            tags: meta['标签'] ? meta['标签'].split(/[，,]/).map(t => t.trim()) : [],
            date: meta['创建日期'] || stats.mtime.toISOString().split('T')[0],
            cover: `wiki_content/${folder}/images/cover.jpg`,
            mdPath: `wiki_content/${folder}/${mdName}`,
            baseDir: `${folder}/`,
            // 抽取文本用于搜索适配
            searchText: raw.replace(/^===\s*[\s\S]*?\s*===\s*/, '').substring(0, 500).replace(/\s+/g, ' ')
        };
    }).filter(Boolean);

    // 按 ID 降序（最新优先）
    index.sort((a, b) => b.id.localeCompare(a.id));

    if (!fs.existsSync(path.dirname(OUTPUT_PATH))) fs.mkdirSync(path.dirname(OUTPUT_PATH), {recursive: true});
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 2));
    console.log(`✅ 档案馆 5.0 索引同步完成: ${index.length} 篇`);
}

scan();