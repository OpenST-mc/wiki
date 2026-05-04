const WORKER_URL = 'https://openstsubmission.linvin.net';

export const ArchiveService = {
    async submit({ title, content, images, article, auth }) {
        const zip = new JSZip();
        const folderName = article ? article.baseDir.replace(/\//g, '') : `archive-${Date.now()}`;
        const fileName = article ? article.mdPath.split('/').pop() : 'index.md';
        const root = zip.folder(folderName);

        // 拼接 YAML 头部
        const finalContent = content.trim().startsWith('===') ? content :
            `===\ntitle: ${title.trim()}\nsummary: ${title.trim()}\ntags: [档案]\n===\n\n${content}`;

        root.file(fileName, finalContent);

        // 处理附件图片
        if (Object.keys(images).length > 0) {
            const imgFolder = root.folder("images");
            for (const [name, fileObj] of Object.entries(images)) {
                imgFolder.file(name, fileObj);
            }
        }

        const userName = auth.user?.login || 'Explorer';
        const fd = new FormData();
        fd.append('file', await zip.generateAsync({ type: "blob" }), 'wiki_update.zip');
        fd.append('user', userName);
        fd.append('title', `[Wiki ${article ? '修正' : '新投稿'}] ${title} - @${userName}`);
        fd.append('path', article ? article.mdPath : `${folderName}/${fileName}`);

        const res = await fetch(`${WORKER_URL}/api/wiki/submit-archive`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${auth.token}` },
            body: fd
        });
        return await res.json();
    }
};