import { PortalAuth } from './auth.js';
import { setupMarked } from './marked_render.js';
import { ArchiveService } from './packet.js';

const { createApp, ref, computed, onMounted, watch } = window.Vue;

// 全局代码复制功能（保持挂载在 window，因为渲染出的 HTML 字符串使用 onclick 调用）
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

createApp({
    setup() {
        // 1. 基础状态
        const wikiList = ref([]);
        const activeArticle = ref(null);
        const renderedContent = ref('');
        const editContent = ref('');
        const searchQuery = ref('');
        const isSidebarOpen = ref(false);
        const DRAFT_KEY = 'openst_wiki_draft_';

        // 2. 身份与权限
        const auth = ref(PortalAuth.get());
        const isAdmin = ref(false);

        // 3. 编辑与投稿状态
        const isEditing = ref(false);
        const isSubmitting = ref(false);
        const editTitle = ref(null);
        const localImages = ref({});
        const imagePreviews = ref({});

        // 4. 分页逻辑
        const currentPage = ref(1);
        const pageSize = ref(9);
        const inputPage = ref(1)
        watch(currentPage, (newVal) => {
            inputPage.value = newVal;
        });
        const jumpToPage = () => {
            let page = parseInt(inputPage.value);
            // 边界检查：防止跳到 0 页或超过总页数
            if (!isNaN(page) && page > 0 && page <= totalPages.value) {
                currentPage.value = page;
            } else {
                // 如果输入非法，回滚到当前页
                inputPage.value = currentPage.value;
            }
        };
        // 5. 初始化与生命周期
        onMounted(async () => {
            // 初始化渲染引擎，传入实时上下文 getter
            setupMarked(() => ({
                previews: imagePreviews.value,
                baseDir: activeArticle.value ? activeArticle.value.baseDir : 'new-wiki/'
            }));

            await initWikiData();
            await handleOAuthCallback();
            await checkIdentity();

            // 快捷键监听
            window.addEventListener('keydown', (e) => {
                if (e.key.toLowerCase() === 'r' &&
                    !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) &&
                    !isEditing.value) {
                    pickRandom();
                }
            });
        });
        // 6. 核心函数
        const initWikiData = async () => {
            try {
                const res = await fetch('./public/wiki.json');
                wikiList.value = await res.json();
                handleHashRoute();
            } catch (e) {
                console.error("Wiki 数据加载失败:", e);
            }
        };

        const loadArticle = async (item) => {
            if (!item) return;
            window.NProgress?.start();

            // 写入 Hash：确保这里使用 item.id
            window.location.hash = `/public/${item.id}`;

            try {
                const res = await fetch(`./${item.mdPath}`);
                const rawMd = await res.text();

                activeArticle.value = item;
                editContent.value = rawMd;

                const contentOnly = rawMd.replace(/^===\s*[\s\S]*?\s*===\s*/, '');
                renderedContent.value = marked.parse(contentOnly);

                isEditing.value = false;
            } catch (e) {
                console.error("文章加载失败:", e);
            } finally {
                window.NProgress?.done();
            }
        };

        const livePreviewContent = computed(() => {
            if (!isEditing.value) return '';
            const contentOnly = editContent.value.replace(/^===\s*[\s\S]*?\s*===\s*/, '');
            return marked.parse(contentOnly);
        });

        const toggleEdit = () => {
            if (!auth.value) return handleLogin();
            if (!activeArticle.value && !isEditing.value) {
                // 新建模式模板
                const now = new Date().toISOString().split('T')[0];
                editContent.value = `===\nid: wiki-${Date.now()}\ntitle: 新文章\nsummary: 请输入简介\ntags: [档案]\ncover: logo.jpg\nupdated: ${now}\n===\n\n# 新文章正文`;
            }
            isEditing.value = !isEditing.value;
        };

        const handleImageUpload = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const vUrl = URL.createObjectURL(file);
            localImages.value[file.name] = file;
            imagePreviews.value[file.name] = vUrl;

            const textarea = document.querySelector('textarea');
            const insertText = `![${file.name}](./images/${file.name})`;
            const start = textarea?.selectionStart || editContent.value.length;

            editContent.value = editContent.value.slice(0, start) + insertText + editContent.value.slice(start);
            e.target.value = ''; // 清空 input 以便下次触发
        };

        const submitArchive = async () => {
            if (!editContent.value.trim() || !auth.value) return alert("内容不能为空且需登录");

            isSubmitting.value = true;
            try {
                // 从正文 YAML 中提取标题
                const titleMatch = editContent.value.match(/title:\s*(.*)/);
                const title = titleMatch ? titleMatch[1].trim() : "未命名档案";

                const result = await ArchiveService.submit({
                    title: title,
                    content: editContent.value,
                    images: localImages.value,
                    article: activeArticle.value,
                    auth: auth.value
                });

                if (result.success) {
                    alert(`提交成功！Issue #${result.issueNumber}`);
                    isEditing.value = false;
                    clearTempData();
                } else {
                    throw new Error(result.error);
                }
            } catch (e) {
                alert(`提交失败: ${e.message}`);
            } finally {
                isSubmitting.value = false;
            }
        };

        // 7. 认证逻辑
        const handleLogin = () => {
            const CLIENT_ID = 'Ov23liTildfj3XAkvbr8';
            const redirect = encodeURIComponent(window.location.origin + window.location.pathname);
            const state = activeArticle.value ? btoa(activeArticle.value.id) : '';
            window.location.href = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=repo&redirect_uri=${redirect}&state=${state}`;
        };

        const handleLogout = () => {
            PortalAuth.logout();
            window.location.reload();
        };

        const checkIdentity = async () => {
            if (!auth.value) return;
            try {
                const res = await fetch(`https://openstsubmission.linvin.net/api/check-admin`, {
                    headers: { 'Authorization': `Bearer ${auth.value.token}` }
                });
                const data = await res.json();
                isAdmin.value = data.isAdmin;
            } catch (e) { console.error("Identity check failed"); }
        };

        const handleOAuthCallback = async () => {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            if (!code) return;

            try {
                const res = await fetch(`https://openstsubmission.linvin.net/api/exchange-token?code=${code}`);
                const data = await res.json();
                if (data.access_token) {
                    await PortalAuth.save(data, true);
                    window.history.replaceState({}, '', window.location.pathname);
                    auth.value = PortalAuth.get();
                    await checkIdentity();
                }
            } catch (e) { console.error("OAuth Exchange Error"); }
        };

        // 8. 辅助函数
        const searchAnalysis = computed(() => {
            const query = searchQuery.value.trim().toLowerCase();

            // 如果没有搜索词，返回空状态结构
            if (!query) return { total: 0, best: [], low: [], suggestions: [], isSearch: false };

            // 1. 打分与初步筛选
            const scoredList = wikiList.value.map(item => {
                let score = 0;
                const title = (item.title || "").toLowerCase();
                const summary = (item.summary || "").toLowerCase();
                const tags = (item.tags || []).map(t => t.toLowerCase());

                // A. 标签匹配 (权重：精准 60，包含 20)
                const isTagSearch = query.startsWith('#');
                const cleanQuery = isTagSearch ? query.slice(1) : query;
                if (tags.some(t => t === cleanQuery)) score += 80;
                else if (tags.some(t => t.includes(cleanQuery))) score += 20;

                // B. 标题匹配 (权重：完全一致 100，包含 40)
                if (title === query) score += 100;
                else if (title.includes(query)) score += 40;
                else {
                    // 字母级模糊匹配 (权重 5)
                    const chars = [...query];
                    if (chars.length > 1 && chars.every(c => title.includes(c))) score += 5;
                }

                // C. 摘要匹配 (权重 10)
                if (summary.includes(query)) score += 10;

                return { ...item, _score: score };
            }).filter(i => i._score > 0);

            // 按得分排序
            scoredList.sort((a, b) => b._score - a._score);

            // 2. 结果分级 (阈值设定)
            // 满分基准 100，22% 即得分为 22
            const threshold = 22;
            const best = scoredList.filter(i => i._score >= threshold);
            const low = scoredList.filter(i => i._score < threshold);

            // 3. 兜底：如果啥也没搜到，随机推荐 3 篇
            const suggestions = scoredList.length === 0
                ? [...wikiList.value].sort(() => 0.5 - Math.random()).slice(0, 3)
                : [];

            return {
                total: scoredList.length,
                best,
                low,
                suggestions,
                isSearch: true
            };
        });

        const pagedList = computed(() => {
            if (searchAnalysis.value.isSearch) {
                // 搜索模式下，分页只处理“精选结果”
                const start = (currentPage.value - 1) * pageSize.value;
                return searchAnalysis.value.best.slice(start, start + pageSize.value);
            }
            const start = (currentPage.value - 1) * pageSize.value;
            // 非搜索模式：按原逻辑排序
            const defaultList = [...wikiList.value].sort((a, b) =>
                (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
                new Date(b.updated || 0) - new Date(a.updated || 0)
            );
            return defaultList.slice(start, start + pageSize.value);
        });

        const totalPages = computed(() => {
            const list = searchAnalysis.value.isSearch ? searchAnalysis.value.best : wikiList.value;
            return Math.ceil(list.length / pageSize.value);
        });

        const clearTempData = () => {
            localImages.value = {};
            Object.values(imagePreviews.value).forEach(URL.revokeObjectURL);
            imagePreviews.value = {};
        };

        const pickRandom = () => {
            if (wikiList.value.length) {
                loadArticle(wikiList.value[Math.floor(Math.random() * wikiList.value.length)]);
            }
        };

        const changePage = (p) => {
            if (p >= 1 && p <= totalPages.value) {
                currentPage.value = p;
                document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };

        const handleHashRoute = () => {
            const hash = window.location.hash;

            // 情况 A：路径匹配 #/article/xxx
            if (hash.startsWith('#/public/')) {
                const articleId = hash.replace('#/public/', '');
                const target = wikiList.value.find(item => item.id === articleId);

                if (target) {
                    loadArticle(target);
                } else {
                    // 没找到，退回列表
                    backToList();
                }
            }
            // 情况 B：路径为空或返回首页
            else if (!hash || hash === '#/') {
                activeArticle.value = null;
                isEditing.value = false;
            }
        };
        window.addEventListener('hashchange', handleHashRoute);

        // 9. 返回对象
        return {
            // 状态
            wikiList, activeArticle, renderedContent, editContent, searchQuery,
            isSidebarOpen, auth, isAdmin, isEditing, isSubmitting,
            pagedList, currentPage, totalPages, inputPage, livePreviewContent,searchAnalysis,jumpToPage,handleHashRoute,
            // 动作
            loadArticle, toggleEdit, handleImageUpload, submitArchive,
            handleLogin, handleLogout, pickRandom, changePage,
            triggerFileInput: () => document.querySelector('input[type="file"]')?.click(),
            backToList: () => {
                activeArticle.value = null;
                isEditing.value = false;
                clearTempData();
                window.location.hash = '/';
            }
        };
    }
}).mount('#app');