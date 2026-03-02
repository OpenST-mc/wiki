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

// 1. Markdown 渲染扩展
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
    code(token) {
        const code = token.text || '';
        const lang = token.lang || '';
        const validLang = (lang && hljs.getLanguage(lang)) ? lang : 'plaintext';
        const highlighted = hljs.highlight(code, { language: validLang }).value;
        return `<pre data-lang="${validLang.toUpperCase()}"><button class="copy-btn" onclick="window.copyCode(this)">Copy</button><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
    },
    image(token) {
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
        const widMatch = rawHref.match(/wid=([^ ]+)/);
        const heigMatch = rawHref.match(/heig=([^ ]+)/);
        let cleanHref = rawHref.replace(/wid=[^ ]+/g, '').replace(/heig=[^ ]+/g, '').trim();
        const fileName = cleanHref.split('/').pop();
        let styles = [];
        if (widMatch) styles.push(`width: ${widMatch[1]}`);
        if (heigMatch) styles.push(`height: ${heigMatch[1]}`);
        const styleAttr = styles.length ? `style="${styles.join('; ')}"` : '';
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

        const auth = ref(PortalAuth.get());
        const isAdmin = ref(false);
        const isEditing = ref(false);
        const isSubmitting = ref(false);
        const editTitle = ref('');
        const editSummary = ref('');
        const editTags = ref('');

        const localImages = ref({});
        const imagePreviews = ref({});
        const converterS2T = ref(null);
        const converterT2S = ref(null);

        const createWikiRenderer = (baseDir) => {
            const renderer = new marked.Renderer();
            renderer.imageCustom = (token) => {
                let rawHref = token.href || '';
                let text = token.text || '';
                if (!rawHref) return '';
                const widMatch = rawHref.match(/wid=([^ ]+)/);
                const heigMatch = rawHref.match(/heig=([^ ]+)/);
                let cleanHref = rawHref.replace(/wid=[^ ]+/g, '').replace(/heig=[^ ]+/g, '').trim();
                const fileName = cleanHref.split('/').pop();
                let styles = [];
                if (widMatch) styles.push(`width: ${widMatch[1]}`);
                if (heigMatch) styles.push(`height: ${heigMatch[1]}`);
                const styleAttr = styles.length ? `style="${styles.join('; ')}"` : '';
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
                return `<div class="img-container flex flex-col items-center my-6"><img src="${src}" alt="${text}" ${styleAttr} class="max-w-full rounded-lg shadow-md" onerror="console.warn('图片加载失败:', '${src}')">${text ? `<p class="img-caption text-xs mt-2 opacity-50 italic"># ${text}</p>` : ''}</div>`;
            };
            renderer.image = (token) => renderer.imageCustom(token);
            return renderer;
        };

        const livePreviewContent = computed(() => {
            if (!isEditing.value) return '';
            const contentOnly = editContent.value.replace(/^===\s*[\s\S]*?\s*===\s*/, '');
            globalBaseDir = activeArticle.value ? activeArticle.value.baseDir : 'new-wiki/';
            globalImagePreviews.value = imagePreviews.value;
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
                const metaMatch = rawMd.match(/^===\s*([\s\S]*?)\s*===\s*/);
                if (metaMatch) {
                    const metaStr = metaMatch[1];
                    editTitle.value = metaStr.match(/title:\s*(.*)/)?.[1] || item.title;
                    editSummary.value = metaStr.match(/summary:\s*(.*)/)?.[1] || item.summary;
                    editTags.value = metaStr.match(/tags:\s*\[(.*)\]/)?.[1] || (item.tags || []).join(', ');
                }
                const contentOnly = rawMd.replace(/^===\s*[\s\S]*?\s*===\s*/, '');

                // 加载全文到编辑器（含头部），保持编辑连续性
                editContent.value = rawMd;
                activeArticle.value = item;

                globalBaseDir = item.baseDir;
                renderedContent.value = marked.parse(contentOnly);

                isEditing.value = false;
            } catch (e) { console.error(e); }
            finally { window.NProgress?.done(); }
        };

        const handleImageUpload = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const vUrl = URL.createObjectURL(file);
            localImages.value[file.name] = file;
            imagePreviews.value[file.name] = vUrl;
            const textarea = e.target.closest('#app').querySelector('textarea');
            const start = textarea ? textarea.selectionStart : editContent.value.length;
            const end = textarea ? textarea.selectionEnd : editContent.value.length;
            const text = editContent.value;
            const insertText = `![${file.name}](./images/${file.name})`;
            editContent.value = text.substring(0, start) + insertText + text.substring(end);
            e.target.value = '';
        };

        const submitArchive = async () => {
            if (!editTitle.value.trim() || !editContent.value.trim() || !auth.value) {
                alert("标题和内容不能为空，且需登录 GitHub");
                return;
            }
            isSubmitting.value = true;
            try {
                const zip = new JSZip();
                const item = activeArticle.value;
                const userName = auth.value.user?.login || 'Explorer';
                const folderName = item ? item.baseDir.replace(/\//g, '') : `archive-${Date.now()}`;
                const fileName = item ? item.mdPath.split('/').pop() : 'index.md';
                const root = zip.folder(folderName);

                // 如果编辑内容本身已经有 === 头部，则不再重复拼接
                const finalContent = editContent.value.trim().startsWith('===')
                    ? editContent.value
                    : `===\ntitle: ${editTitle.value.trim()}\nsummary: ${item?.summary || editTitle.value.trim()}\ntags: [${(item?.tags || ['档案']).join(', ')}]\ncover: ${item?.cover || ''}\n===\n\n${editContent.value}`;

                root.file(fileName, finalContent);
                if (Object.keys(localImages.value).length > 0) {
                    const imgFolder = root.folder("images");
                    for (const [name, fileObj] of Object.entries(localImages.value)) {
                        imgFolder.file(name, fileObj);
                    }
                }
                const actionType = item ? "修正" : "新投稿";
                const issueTitle = `[Wiki ${actionType}] ${editTitle.value} - @${userName}`;
                const issueBody = `### 📝 Wiki 档案提交报告\n- **操作类型**: ${actionType}\n- **文章标题**: ${editTitle.value}\n- **贡献者**: @${userName}\n- **目标路径**: \`${item ? item.mdPath : folderName + '/' + fileName}\`\n- **提交时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} (UTC+8)\n---\n> 该 Issue 由 OpenST Wiki 编辑器自动生成。`.trim();
                const blob = await zip.generateAsync({ type: "blob" });
                const fd = new FormData();
                fd.append('file', blob, 'wiki_update.zip');
                fd.append('user', userName);
                fd.append('title', issueTitle);
                fd.append('body', issueBody);
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
                    localImages.value = {};
                    Object.values(imagePreviews.value).forEach(URL.revokeObjectURL);
                    imagePreviews.value = {};
                } else { throw new Error(data.error || "提交失败"); }
            } catch (e) { alert(`❌ 错误: ${e.message}`); }
            finally { isSubmitting.value = false; }
        };

        const toggleEdit = () => {
            if (!auth.value) return handleLogin();

            // 新建文章时填充 YAML 模板
            if (!activeArticle.value && !isEditing.value) {
                const now = new Date().toISOString().split('T')[0];
                const defaultID = `wiki-${Math.floor(Math.random() * 1000000000)}`;
                editTitle.value = "新文章";
                editContent.value = `===
id: ${defaultID}
简介: 请在此输入文章简介
标签: 档案, 教学
封面: logo.jpg
上次修改日期: ${now}
===

# 请在此开始编写正文`;
                isEditing.value = true;
            } else {
                isEditing.value = !isEditing.value;
            }
        };

        const filteredList = computed(() => {
            let list = wikiList.value.filter(i => {
                const q = searchQuery.value.trim().toLowerCase();
                if (!q) return true;
                const pool = `${i.title} ${i.summary} ${(i.tags || []).join(' ')}`.toLowerCase();
                return pool.includes(q);
            });
            list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
            return list;
        });

        const pickRandom = () => {
            if (!wikiList.value.length) return;
            loadArticle(wikiList.value[Math.floor(Math.random() * wikiList.value.length)]);
        };
        const pagedList = computed(() => {
            const start = (currentPage.value - 1) * pageSize.value;
            return filteredList.value.slice(start, start + pageSize.value);
        });
        const totalPages = computed(() => Math.ceil(filteredList.value.length / pageSize.value));
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
            const main = document.getElementById('main-content');
            if (main) { main.scrollTo({ top: 0, behavior: 'smooth' }); }
        };
        const inputPage = ref(1);
        watch(currentPage, (val) => { inputPage.value = val; });
        const jumpToPage = () => {
            let p = parseInt(inputPage.value);
            if (isNaN(p)) { inputPage.value = currentPage.value; return; }
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
            toggleEdit, submitArchive, triggerFileInput,
            currentPage, pageSize, totalPages, pagedList,
            changePage, jumpToPage, inputPage,
            editTitle, editSummary, editTags,
            converterS2T, converterT2S,
        };
    }
}).mount('#app');