import { PortalAuth } from './auth.js';

const { createApp, ref, computed, onMounted, watch } = window.Vue;
const WORKER_URL = 'https://openstsubmission.linvin.net';
let globalImagePreviews = { value: {} };
let globalBaseDir = '';
window.copyCode = async (btn) => {
    const pre = btn.parentElement;
    const code = pre.querySelector('code').innerText;

    try {
        await navigator.clipboard.writeText(code);
        const oldText = btn.innerText;
        btn.innerText = 'COPIED!';
        btn.classList.add('copied');

        setTimeout(() => {
            btn.innerText = oldText;
            btn.classList.remove('copied');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy: ', err);
    }
};

// --- 1. Markdown 渲染扩展 ---
const maskExtension = {
    name: 'mask',
    level: 'inline',
    start(src) { return src.match(/!!/)?.index; },
    tokenizer(src) {
        const match = /^!!([^!!]+)!!/.exec(src);
        if (match) return { type: 'mask', raw: match[0], text: match[1] };
    },
    renderer(token) { return `<span class="text-mask" title="档案加密内容">${token.text}</span>`; }
};
marked.use({ extensions: [maskExtension] });
marked.setOptions({
    gfm: true, breaks: true,
    highlight: (code, lang) => {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
    }
});

const customRenderer = {
    // 💡 修复：代码块渲染
    code(token) {
        const code = token.text || '';
        const lang = token.lang || '';
        const validLang = (lang && hljs.getLanguage(lang)) ? lang : 'plaintext';
        const highlighted = hljs.highlight(code, { language: validLang }).value;
        return `<pre data-lang="${validLang.toUpperCase()}"><button class="copy-btn" onclick="window.copyCode(this)">Copy</button><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
    },
    // 💡 修复：如果图片被识别为标准 Image 而非 imageCustom 扩展
    image(token) {
        // 直接复用你 imageCustom 的逻辑或者让它走统一路径
        return this.imageCustom(token);
    }
};


const imageCustomExtension = {
    name: 'imageCustom',
    level: 'inline',
    start(src) { return src.match(/!\[/)?.index; },
    tokenizer(src) {
        const match = /^!\[([\s\S]*?)\]\(([\s\S]*?)\)/.exec(src);
        if (match) {
            return {
                type: 'imageCustom',
                raw: match[0],
                text: match[1],
                href: match[2],
            };
        }
    },
    renderer(token) {
        const rawHref = token.href || '';
        const text = token.text || '';

        // 1. 提取参数
        const widMatch = rawHref.match(/wid=([^ ]+)/);
        const heigMatch = rawHref.match(/heig=([^ ]+)/);

        // 2. 清洗路径并提取文件名
        let cleanHref = rawHref.replace(/wid=[^ ]+/g, '').replace(/heig=[^ ]+/g, '').trim();
        const fileName = cleanHref.split('/').pop();

        // 3. 构造样式
        let styles = [];
        if (widMatch) styles.push(`width: ${widMatch[1]}`);
        if (heigMatch) styles.push(`height: ${heigMatch[1]}`);
        const styleAttr = styles.length ? `style="${styles.join('; ')}"` : '';

        // 4. 决定来源 (使用全局引用)
        let src = '';
        if (globalImagePreviews.value && globalImagePreviews.value[fileName]) {
            src = globalImagePreviews.value[fileName];
        } else if (!cleanHref.startsWith('http') && !cleanHref.startsWith('blob:')) {
            const dir = globalBaseDir ? globalBaseDir.replace(/\/$/, '') + '/' : '';
            const purePath = cleanHref.replace(/^\.\//, '');
            src = `wiki_content/${dir}${purePath}`;
        } else {
            src = cleanHref;
        }

        return `
        <div class="img-container flex flex-col items-center my-6">
            <img src="${src}" alt="${text}" ${styleAttr} class="max-w-full rounded-lg shadow-md" onerror="console.warn('加载失败:', '${src}')">
            ${text ? `<p class="img-caption text-xs mt-2 opacity-50 italic"># ${text}</p>` : ''}
        </div>`;
    }
};

marked.use({
    renderer: customRenderer,
    extensions: [maskExtension, imageCustomExtension],
    gfm: true,
    breaks: true
});



createApp({
    setup() {
        const wikiList = ref([]);
        const activeArticle = ref(null);
        const renderedContent = ref('');
        const editContent = ref('');
        const searchQuery = ref('');
        const scrollRoot = ref(null);
        const currentPage = ref(1);
        const pageSize = ref(9);

        // Auth & 编辑状态
        const auth = ref(PortalAuth.get());
        const isAdmin = ref(false);
        const isEditing = ref(false);
        const isSubmitting = ref(false);
        const editTitle = ref('');
        const editSummary = ref('');
        const editTags = ref('');

        // 💡 图片处理核心仓库
        const localImages = ref({});     // { "name.png": FileObject }
        const imagePreviews = ref({});   // { "name.png": "blob:url" }

        const converterS2T = ref(null);
        const converterT2S = ref(null);

        // --- 逻辑：创建渲染器 ---
        const createWikiRenderer = (baseDir) => {
            const renderer = new marked.Renderer();

            // 💡 重点：直接定义 imageCustom 处理函数
            renderer.imageCustom = (token) => {
                let rawHref = token.href || '';
                let text = token.text || '';
                if (!rawHref) return '';

                // 1. 🔍 提取参数
                const widMatch = rawHref.match(/wid=([^ ]+)/);
                const heigMatch = rawHref.match(/heig=([^ ]+)/);

                // 2. 🧽 清洗路径
                let cleanHref = rawHref.replace(/wid=[^ ]+/g, '').replace(/heig=[^ ]+/g, '').trim();
                const fileName = cleanHref.split('/').pop();

                // 3. 构造样式
                let styles = [];
                if (widMatch) styles.push(`width: ${widMatch[1]}`);
                if (heigMatch) styles.push(`height: ${heigMatch[1]}`);
                const styleAttr = styles.length ? `style="${styles.join('; ')}"` : '';

                // 4. 决定来源
                let src = '';
                if (imagePreviews.value && imagePreviews.value[fileName]) {
                    src = imagePreviews.value[fileName];
                } else if (!cleanHref.startsWith('http') && !cleanHref.startsWith('blob:')) {
                    const dir = baseDir ? baseDir.replace(/\/$/, '') + '/' : '';
                    const purePath = cleanHref.replace(/^\.\//, '');
                    src = `wiki_content/${dir}${purePath}`;
                } else {
                    src = cleanHref;
                }

                return `
        <div class="img-container flex flex-col items-center my-6">
            <img src="${src}" 
                 alt="${text}" 
                 ${styleAttr}
                 class="max-w-full rounded-lg shadow-md"
                 onerror="console.warn('图片加载失败:', '${src}')">
            ${text ? `<p class="img-caption text-xs mt-2 opacity-50 italic"># ${text}</p>` : ''}
        </div>`;
            };

            // 兼容可能被识别为标准 image 的 token
            renderer.image = (token) => renderer.imageCustom(token);

            return renderer;
        };

        // --- 逻辑：实时预览内容 ---
        const livePreviewContent = computed(() => {
            if (!isEditing.value) return '';
            const contentOnly = editContent.value.replace(/^===\s*[\s\S]*?\s*===\s*/, '');

            globalBaseDir = activeArticle.value ? activeArticle.value.baseDir : 'new-wiki/';
            globalImagePreviews.value = imagePreviews.value; // 确保预览时也能拿到新上传的图

            return marked.parse(contentOnly);
        });

        const fileInput = ref(null);
        const triggerFileInput = () => {
            const el = document.querySelector('input[type="file"]');
            if (el) el.click();
        };

        const handleLogin = () => {
            const CLIENT_ID = 'Ov23liTildfj3XAkvbr8';
            const redirect_uri = window.location.origin + window.location.pathname;
            const state = activeArticle.value ? btoa(activeArticle.value.id) : '';
            window.location.href = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=repo&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${state}`;
        };

        const handleLogout = () => {
            PortalAuth.logout();
            auth.value = null;
            isAdmin.value = false;
            window.location.reload();
        };

        const checkIdentity = async () => {
            const currentAuth = PortalAuth.get();
            auth.value = currentAuth;
            if (!currentAuth) return;
            try {
                const res = await fetch(`${WORKER_URL}/api/check-admin`, {
                    headers: { 'Authorization': `Bearer ${currentAuth.token}` }
                });
                const data = await res.json();
                isAdmin.value = data.isAdmin;
            } catch (e) { console.error("Admin check failed", e); }
        };

        const handleOAuthCallback = async () => {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const state = params.get('state');
            if (code) {
                try {
                    const res = await fetch(`${WORKER_URL}/api/exchange-token?code=${code}`);
                    const data = await res.json();
                    if (data.access_token) {
                        await PortalAuth.save(data, true);
                        window.history.replaceState({}, '', window.location.pathname);
                        await checkIdentity();
                        if (state) {
                            try {
                                const targetId = atob(state);
                                const item = wikiList.value.find(i => i.id === targetId);
                                if (item) loadArticle(item);
                            } catch(e) { console.error("State restore failed", e); }
                        }
                    }
                } catch (e) { console.error("OAuth Exchange Error:", e); }
            }
        };

        const initWikiData = async () => {
            try {
                const res = await fetch('./public/wiki.json');
                wikiList.value = await res.json();
                if (window.OpenCC) {
                    converterS2T.value = await OpenCC.Converter({ from: 'cn', to: 'hk' });
                    converterT2S.value = await OpenCC.Converter({ from: 'hk', to: 'cn' });
                }
            } catch (e) { console.error("Init Wiki failed:", e); }
        };

        const loadArticle = async (item) => {
            window.NProgress?.start();
            try {
                const res = await fetch(`./${item.mdPath}`);
                const rawMd = await res.text();

                // 解析 YAML (简单正则解析)
                const metaMatch = rawMd.match(/^===\s*([\s\S]*?)\s*===\s*/);
                if (metaMatch) {
                    const metaStr = metaMatch[1];
                    editTitle.value = metaStr.match(/title:\s*(.*)/)?.[1] || item.title;
                    editSummary.value = metaStr.match(/summary:\s*(.*)/)?.[1] || item.summary;
                    editTags.value = metaStr.match(/tags:\s*\[(.*)\]/)?.[1] || (item.tags || []).join(', ');
                }

                editContent.value = rawMd.replace(/^===\s*[\s\S]*?\s*===\s*/, ''); // 只保留正文
                activeArticle.value = item;
                isEditing.value = false;
            } catch (e) { console.error(e); }
            finally { window.NProgress?.done(); }
        };

        const handleImageUpload = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // 1. 准备资源
            const vUrl = URL.createObjectURL(file);
            localImages.value[file.name] = file;
            imagePreviews.value[file.name] = vUrl;

            // 2. 获取文本框（使用更稳妥的方式）
            const textarea = e.target.closest('#app').querySelector('textarea');
            const start = textarea ? textarea.selectionStart : editContent.value.length;
            const end = textarea ? textarea.selectionEnd : editContent.value.length;
            const text = editContent.value;

            // 3. 插入带 images/ 的路径
            const insertText = `![${file.name}](./images/${file.name})`;
            editContent.value = text.substring(0, start) + insertText + text.substring(end);

            // 4. 重置 input
            e.target.value = '';
        };

        const submitArchive = async () => {
            // 基础校验
            if (!editTitle.value.trim() || !editContent.value.trim() || !auth.value) {
                alert("标题和内容不能为空，且需登录 GitHub");
                return;
            }
            isSubmitting.value = true;

            try {
                const zip = new JSZip();
                const item = activeArticle.value;
                const userName = auth.value.user?.login || 'Explorer';

                // 1. 确定文件夹和文件名逻辑
                const folderName = item ? item.baseDir.replace(/\//g, '') : `archive-${Date.now()}`;
                const fileName = item ? item.mdPath.split('/').pop() : 'index.md';
                const root = zip.folder(folderName);

                // 2. 拼接固定 Markdown 文本 (注意：左侧不要留缩进，否则 YAML 解析会报错)
                const fullContent = `===
title: ${editTitle.value.trim()}
summary: ${item?.summary || editTitle.value.trim()}
tags: [${(item?.tags || ['档案']).join(', ')}]
cover: ${item?.cover || ''}
===

${editContent.value}`;

                // 3. 写入文件
                root.file(fileName, fullContent);

                // 4. 处理图片附件
                if (Object.keys(localImages.value).length > 0) {
                    const imgFolder = root.folder("images");
                    for (const [name, fileObj] of Object.entries(localImages.value)) {
                        imgFolder.file(name, fileObj);
                    }
                }

                // 5. 构建专业且清晰的 Issue 文案
                const actionType = item ? "修正" : "新投稿";
                const issueTitle = `[Wiki ${actionType}] ${editTitle.value} - @${userName}`;
                const issueBody = `
                   ### 📝 Wiki 档案提交报告

                   - **操作类型**: ${actionType}
                   - **文章标题**: ${editTitle.value}
                   - **贡献者**: @${userName}
                   - **目标路径**: \`${item ? item.mdPath : folderName + '/' + fileName}\`
                   - **提交时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} (UTC+8)

                   ---
                   > 该 Issue 由 OpenST Wiki 编辑器自动生成。
                   `.trim();

                // 6. 准备发送
                const blob = await zip.generateAsync({ type: "blob" });
                const fd = new FormData();
                fd.append('file', blob, 'wiki_update.zip');
                fd.append('user', userName);
                fd.append('title', issueTitle); // Issue 标题
                fd.append('body', issueBody);   // Issue 正文 (需 Worker 支持接收 body 字段)
                fd.append('path', item ? item.mdPath : `${folderName}/${fileName}`);

                const res = await fetch(`${WORKER_URL}/api/wiki/submit-archive`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${auth.value.token}` },
                    body: fd
                });

                const data = await res.json();
                if (data.success) {
                    alert(`✅ 提交成功！\n已创建 Issue #${data.issueNumber}\n请等待 Staff 审核处理。`);
                    isEditing.value = false;
                    // 清理状态
                    localImages.value = {};
                    Object.values(imagePreviews.value).forEach(URL.revokeObjectURL);
                    imagePreviews.value = {};
                } else {
                    throw new Error(data.error || "提交失败");
                }
            } catch (e) {
                alert(`❌ 错误: ${e.message}`);
            } finally {
                isSubmitting.value = false;
            }
        };


        const toggleEdit = () => {
            if (!auth.value) return handleLogin();

            // 如果是从列表页点“新建文章”（此时 activeArticle 为空）
            if (!activeArticle.value && !isEditing.value) {
                editTitle.value = "";
                editContent.value = "";
                isEditing.value = true;
            } else {
                isEditing.value = !isEditing.value;
            }
        };

        const filteredList = computed(() => {
            // 搜索过滤
            let list = wikiList.value.filter(i => {
                const q = searchQuery.value.trim().toLowerCase();
                if (!q) return true;
                const pool = `${i.title} ${i.summary} ${(i.tags || []).join(' ')}`.toLowerCase();
                return pool.includes(q);
            });

            // 置顶排序
            list.sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return 0;
            });

            return list;
        });

        const pickRandom = () => {
            if (!wikiList.value.length) return;
            loadArticle(wikiList.value[Math.floor(Math.random() * wikiList.value.length)]);
        };
        const pagedList = computed(() => {
            const start = (currentPage.value - 1) * pageSize.value;
            const end = start + pageSize.value;
            return filteredList.value.slice(start, end);
        });
        // 总页数计算
        const totalPages = computed(() => {
            const total = filteredList.value.length;
            return Math.ceil(total / pageSize.value);
        });

        // 搜索时重置页码
        watch(searchQuery, () => { currentPage.value = 1; });

        onMounted(async () => {
            await initWikiData();
            await handleOAuthCallback();
            await checkIdentity();
            window.addEventListener('keydown', (e) => {
                if (e.key.toLowerCase() === 'r' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !isEditing.value) {
                    pickRandom();
                }
            });
        });
        const changePage = (p) => {
            if (p < 1 || p > totalPages.value) return;
            currentPage.value = p;

            // 💡 让滚动条丝滑地滚回顶部
            const main = document.getElementById('main-content');
            if (main) {
                main.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            }
        };
        const inputPage = ref(1);

        // 监听当前页码，当页码改变时同步输入框的值
        watch(currentPage, (val) => {
            inputPage.value = val;
        });

        const jumpToPage = () => {
            let p = parseInt(inputPage.value);
            if (isNaN(p)) {
                inputPage.value = currentPage.value;
                return;
            }
            if (p < 1) p = 1;
            if (p > totalPages.value) p = totalPages.value;

            changePage(p);
        };

        return {
            wikiList, filteredList, activeArticle, renderedContent, editContent,
            searchQuery, scrollRoot, auth, isAdmin, isEditing, isSubmitting,
            localImages, livePreviewContent,
            loadArticle, handleImageUpload,
            backToList: () => {
                activeArticle.value = null;
                isEditing.value = false;
                localImages.value = {};
                Object.values(imagePreviews.value).forEach(URL.revokeObjectURL);
                imagePreviews.value = {};
            },
            pickRandom, handleLogin, handleLogout,
            toggleEdit: () => {
                if(!auth.value) return handleLogin();
                isEditing.value = !isEditing.value;
            },
            submitArchive,
            triggerFileInput,
            currentPage,
            pageSize,
            totalPages,
            pagedList,
            changePage,
            jumpToPage,
            inputPage,
            editTitle, editSummary, editTags,
            converterS2T, converterT2S,
        };
    }
}).mount('#app');