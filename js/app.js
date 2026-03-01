import { PortalAuth } from './auth.js';

const { createApp, ref, computed, onMounted, watch } = window.Vue;
const WORKER_URL = 'https://openstsubmission.linvin.net';

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

createApp({
    setup() {
        const wikiList = ref([]);
        const activeArticle = ref(null);
        const renderedContent = ref('');
        const editContent = ref('');
        const searchQuery = ref('');
        const scrollRoot = ref(null);

        // Auth & 编辑状态
        const auth = ref(PortalAuth.get());
        const isAdmin = ref(false);
        const isEditing = ref(false);
        const isSubmitting = ref(false);

        // 💡 图片处理核心仓库
        const localImages = ref({});     // { "name.png": FileObject }
        const imagePreviews = ref({});   // { "name.png": "blob:url" }

        const converterS2T = ref(null);
        const converterT2S = ref(null);

        // --- 逻辑：创建渲染器 ---
        const createWikiRenderer = (baseDir) => {
            const renderer = new marked.Renderer();
            renderer.image = (href, title, text) => {
                if (!href) return '';
                let src = href;
                const fileName = href.split('/').pop();

                // 使用 ?. 防止 imagePreviews.value 为空时崩溃
                if (imagePreviews.value?.[fileName]) {
                    src = imagePreviews.value[fileName];
                } else if (!href.startsWith('http') && !href.startsWith('blob:')) {
                    const dir = baseDir ? baseDir.replace(/\/$/, '') + '/' : '';
                    src = `wiki_content/${dir}${href.replace('./', '')}`;
                }
                return `<div class="img-container"><img src="${src}" alt="${text||''}"><p class="img-caption">${text||''}</p></div>`;
            };
            return renderer;
        };

        // --- 逻辑：实时预览内容 ---
        const livePreviewContent = computed(() => {
            if (!isEditing.value) return '';
            const contentOnly = editContent.value.replace(/^===\s*[\s\S]*?\s*===\s*/, '');
            const baseDir = activeArticle.value ? activeArticle.value.baseDir : 'new-wiki/';
            return marked.parse(contentOnly, { renderer: createWikiRenderer(baseDir) });
        });

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
            try {
                const res = await fetch(`./${item.mdPath}`);
                const rawMd = await res.text();
                editContent.value = rawMd;
                const contentOnly = rawMd.replace(/^===\s*[\s\S]*?\s*===\s*/, '');
                renderedContent.value = marked.parse(contentOnly, { renderer: createWikiRenderer(item.baseDir) });
                activeArticle.value = item;
                isEditing.value = false;
                if (scrollRoot.value) scrollRoot.value.scrollTop = 0;
            } catch (e) { console.error("Load article failed:", e); }
        };

        // 💡 图片上传处理
        const handleImageUpload = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const vUrl = URL.createObjectURL(file);
            localImages.value[file.name] = file;
            imagePreviews.value[file.name] = vUrl;
            // 自动插入 Markdown 语法
            editContent.value += `\n\n![${file.name}](./${file.name})`;
            e.target.value = ''; // Reset
        };

        const submitArchive = async () => {
            if (!editContent.value || !auth.value) return;
            isSubmitting.value = true;
            try {
                const zip = new JSZip();
                const item = activeArticle.value;
                const folderName = item ? item.baseDir.replace(/\//g, '') : `new-wiki-${Date.now()}`;
                const fileName = item ? item.mdPath.split('/').pop() : 'index.md';

                // 1. 压入 Markdown 内容
                zip.file(`${folderName}/${fileName}`, editContent.value);

                // 2. 压入所有本地上传的图片
                for (const [name, fileObj] of Object.entries(localImages.value)) {
                    zip.file(`${folderName}/${name}`, fileObj);
                }

                const blob = await zip.generateAsync({ type: "blob" });
                const fd = new FormData();
                fd.append('file', blob, 'archive_update.zip');
                fd.append('user', auth.value.user?.login || 'Explorer');
                fd.append('title', item ? `[修正] ${item.title}` : `[新投稿] 未命名`);
                fd.append('path', item ? item.mdPath : 'root/new_archive');

                const res = await fetch(`${WORKER_URL}/api/wiki/submit-archive`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${auth.value.token}` },
                    body: fd
                });

                const data = await res.json();
                if (data.success) {
                    alert(`✅ 提交成功！已创建 PR/Issue #${data.issueNumber}`);
                    // 清理工作
                    localImages.value = {};
                    Object.values(imagePreviews.value).forEach(URL.revokeObjectURL);
                    imagePreviews.value = {};
                    isEditing.value = false;
                } else { throw new Error(data.error || "Submission Failed"); }
            } catch (e) {
                alert(`❌ 错误: ${e.message}`);
            } finally {
                isSubmitting.value = false;
            }
        };

        const filteredList = computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            if (!q) return wikiList.value;
            const qS = converterT2S.value ? converterT2S.value(q) : q;
            const qT = converterS2T.value ? converterS2T.value(q) : q;
            return wikiList.value.filter(i => {
                const pool = `${i.title} ${i.summary} ${(i.tags || []).join(' ')} ${i.searchText || ''}`.toLowerCase();
                return pool.includes(q) || pool.includes(qS) || pool.includes(qT);
            });
        });

        const pickRandom = () => {
            if (!wikiList.value.length) return;
            loadArticle(wikiList.value[Math.floor(Math.random() * wikiList.value.length)]);
        };

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
            submitArchive
        };
    }
}).mount('#app');