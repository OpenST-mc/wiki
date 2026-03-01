import { PortalAuth } from './auth.js';

const { createApp, ref, computed, onMounted } = window.Vue;
const WORKER_URL = 'https://openstsubmission.linvin.net';

// --- 1. Markdown 扩展配置 ---
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
        // --- 响应式数据 ---
        const wikiList = ref([]);
        const activeArticle = ref(null);
        const renderedContent = ref('');
        const searchQuery = ref('');
        const scrollRoot = ref(null);

        // Auth & 编辑器状态
        // 初始化时获取一次状态
        const auth = ref(PortalAuth.get());
        const isAdmin = ref(false);
        const isEditing = ref(false);
        const editContent = ref('');
        const isSubmitting = ref(false);

        const converterS2T = ref(null);
        const converterT2S = ref(null);

        // --- 2. 核心身份验证逻辑 ---

        const handleLogin = () => {
            const CLIENT_ID = 'Ov23liTildfj3XAkvbr8';
            const redirect_uri = window.location.origin + window.location.pathname;
            // 使用 state 记录当前阅读状态，Base64 编码
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
            } catch (e) {
                console.error("Admin check failed", e);
            }
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
                        // 存入 Auth 模块
                        await PortalAuth.save(data, true);
                        // 清理 URL 参数
                        window.history.replaceState({}, '', window.location.pathname);

                        // 💡 关键修复：登录成功后立即刷新响应式变量
                        await checkIdentity();

                        // 如果有 state，恢复阅读进度
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

        // --- 3. 档案馆核心逻辑 ---

        const initWikiData = async () => {
            try {
                const res = await fetch('./public/wiki.json');
                wikiList.value = await res.json();
                // 异步加载转换器
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
                const renderer = new marked.Renderer();
                renderer.image = (href, title, text) => {
                    const src = href.startsWith('http') ? href : `wiki_content/${item.baseDir}${href}`;
                    return `<div class="img-container"><img src="${src}" alt="${text||''}"><p class="img-caption">${text||''}</p></div>`;
                };

                renderedContent.value = marked.parse(contentOnly, { renderer });
                activeArticle.value = item;
                isEditing.value = false;
                if (scrollRoot.value) scrollRoot.value.scrollTop = 0;
            } catch (e) { console.error("Load article failed:", e); }
        };

        const submitArchive = async () => {
            if (!editContent.value || !auth.value) return;
            isSubmitting.value = true;
            try {
                const zip = new JSZip();
                const item = activeArticle.value;
                const folderName = item ? item.baseDir.replace('/', '') : `new-wiki-${Date.now()}`;
                const fileName = item ? item.mdPath.split('/').pop() : 'index.md';

                zip.file(`${folderName}/${fileName}`, editContent.value);
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
                    alert(`✅ 提交成功！已创建 Issue #${data.issueNumber}`);
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
            await handleOAuthCallback(); // 优先处理 GitHub 跳回逻辑
            await checkIdentity();       // 检查并刷新身份状态

            window.addEventListener('keydown', (e) => {
                // 只有在非输入状态且非编辑状态下按 R 触发随机
                if (e.key.toLowerCase() === 'r' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !isEditing.value) {
                    pickRandom();
                }
            });
        });

        return {
            wikiList, filteredList, activeArticle, renderedContent,
            searchQuery, scrollRoot, auth, isAdmin, isEditing, editContent, isSubmitting,
            loadArticle,
            backToList: () => { activeArticle.value = null; isEditing.value = false; },
            pickRandom,
            handleLogin,
            handleLogout,
            toggleEdit: () => {
                if(!auth.value) return handleLogin();
                isEditing.value = !isEditing.value;
            },
            submitArchive
        };
    }
}).mount('#app');