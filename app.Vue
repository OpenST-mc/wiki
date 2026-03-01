<template>
  <div class="wiki-root font-sans text-slate-300 bg-[#0c0c0c] h-screen w-full overflow-hidden flex flex-col">
    <header class="h-16 flex-none border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between px-4 lg:px-6 z-50">
      <div class="flex items-center gap-4">
        <button @click="isMobileMenuOpen = true" class="p-2 -ml-2 lg:hidden hover:bg-white/5 rounded-lg">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 bg-[#40B5AD] rotate-45 hidden sm:block"></div>
          <span class="font-black tracking-tighter uppercase text-white">OpenST Wiki</span>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <template v-if="user">
          <div class="hidden sm:flex flex-col items-end mr-2">
            <span class="text-[10px] font-mono text-[#40B5AD] leading-none">{{ isAdmin ? 'STAFF' : 'CONTRIBUTOR' }}</span>
            <span class="text-xs opacity-50">{{ user.login }}</span>
          </div>
          <img :src="user.avatar" class="w-8 h-8 rounded-lg border border-white/10" alt="avatar">
          <button @click="handleLogout" class="p-2 hover:text-red-400 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
          </button>
        </template>
        <button v-else @click="handleLogin" class="text-xs font-bold py-2 px-5 rounded-full border border-white/10 hover:bg-white/5 transition-all">
          GITHUB LOGIN
        </button>
      </div>
    </header>

    <div class="flex-1 flex overflow-hidden relative">
      <div v-if="isMobileMenuOpen" @click="isMobileMenuOpen = false" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"></div>

      <aside :class="[
        'absolute lg:relative z-40 w-72 h-full bg-[#0c0c0c] border-r border-white/5 transition-transform duration-300 ease-in-out lg:translate-x-0',
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      ]">
        <nav class="p-6 space-y-8 overflow-y-auto h-full scrollbar-hide text-sm">
          <div v-for="group in menu" :key="group.title">
            <h4 class="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 mb-4">{{ group.title }}</h4>
            <ul class="space-y-3">
              <li v-for="link in group.links" :key="link.path">
                <a @click="loadPage(link.path)"
                   :class="['cursor-pointer transition-colors hover:text-[#40B5AD]', currentPage === link.path ? 'text-[#40B5AD] font-bold' : 'text-slate-400']">
                  {{ link.name }}
                </a>
              </li>
            </ul>
          </div>
        </nav>
      </aside>

      <main ref="scrollRoot" class="flex-1 overflow-y-auto scroll-smooth bg-gradient-to-b from-[#111] to-[#0c0c0c]">
        <article class="max-w-4xl mx-auto py-12 px-6 lg:px-12 prose prose-invert prose-emerald prose-headings:scroll-mt-24 prose-img:rounded-xl">
          <div v-html="renderedContent"></div>
        </article>

        <button v-if="user" @click="isEditorOpen = true"
                class="fixed bottom-6 right-6 lg:bottom-10 lg:right-10 w-14 h-14 bg-[#40B5AD] text-black rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-30">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
        </button>
      </main>
    </div>

    <div v-if="isEditorOpen" class="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md p-4 lg:p-8 flex items-center justify-center text-white">
      <div class="bg-[#151515] w-full max-w-5xl h-full lg:h-[85vh] rounded-2xl border border-white/10 flex flex-col overflow-hidden">
        <div class="p-4 border-b border-white/5 flex items-center justify-between">
          <span class="text-sm font-bold">编辑建议: {{ currentPage }}</span>
          <button @click="isEditorOpen = false" class="hover:text-red-400 transition-colors">CLOSE</button>
        </div>
        <div class="flex-1 flex flex-col lg:flex-row overflow-hidden">
          <textarea v-model="editBuffer" class="flex-1 bg-transparent p-6 outline-none resize-none font-mono text-sm border-b lg:border-b-0 lg:border-r border-white/5 focus:bg-white/[0.02] transition-colors"></textarea>
          <div class="flex-1 p-6 overflow-y-auto prose prose-invert prose-sm hidden lg:block bg-black/20" v-html="previewContent"></div>
        </div>
        <div class="p-4 bg-black/40 flex justify-end gap-4">
          <button @click="submitToIssue" :disabled="isSubmitting" class="bg-[#40B5AD] text-black px-10 py-2.5 rounded-lg font-black text-xs tracking-widest hover:brightness-110 disabled:opacity-30">
            {{ isSubmitting ? 'SUBMITTING...' : 'SUBMIT ISSUE' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { marked } from 'marked';
import { PortalAuth } from './js/auth.js'; // 你的核心鉴权

// 状态管理
const WORKER_URL = "https://openstsubmission.linvin.net";
const CLIENT_ID = 'Ov23liTildfj3XAkvbr8';

const user = ref(null);
const isAdmin = ref(false);
const currentPage = ref('README.md');
const rawMarkdown = ref('');
const editBuffer = ref('');
const isMobileMenuOpen = ref(false);
const isEditorOpen = ref(false);
const isSubmitting = ref(false);

const menu = [
  { title: '入门', links: [{ name: '简介', path: 'README.md' }, { name: '安装指南', path: 'install.md' }] },
  { title: '进阶', links: [{ name: 'API参考', path: 'api.md' }, { name: '开发规范', path: 'dev.md' }] }
];

// 计算渲染内容
const renderedContent = computed(() => marked.parse(rawMarkdown.value));
const previewContent = computed(() => marked.parse(editBuffer.value));

// 初始化身份
const initAuth = async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('code')) {
    const res = await fetch(`${WORKER_URL}/api/exchange-token?code=${params.get('code')}`);
    const data = await res.json();
    if (data.access_token) {
      await PortalAuth.save(data, true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  const auth = PortalAuth.get();
  if (auth) {
    user.ref = auth.user; // 注意你的 auth.js 结构
    user.value = auth.user;
    try {
      const res = await fetch(`${WORKER_URL}/api/check-admin`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
      const data = await res.json();
      isAdmin.value = data.isAdmin;
    } catch (e) { console.error(e); }
  }
};

const handleLogin = () => {
  const redirect_uri = window.location.origin + window.location.pathname;
  window.location.href = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=repo&redirect_uri=${encodeURIComponent(redirect_uri)}`;
};

const handleLogout = () => { PortalAuth.logout(); };

const loadPage = async (path) => {
  try {
    const res = await fetch(`content/${path}`);
    rawMarkdown.value = await res.text();
    editBuffer.value = rawMarkdown.value;
    currentPage.value = path;
    isMobileMenuOpen.value = false;
  } catch (e) { rawMarkdown.value = "# 404\n页面未找到"; }
};

const submitToIssue = async () => {
  const auth = PortalAuth.get();
  isSubmitting.value = true;
  const fd = new FormData();
  fd.append('file', new Blob([editBuffer.value], {type: 'text/markdown'}), 'edit.md');
  fd.append('user', user.value.login);
  fd.append('title', `Wiki补全建议: ${currentPage.value}`);
  fd.append('path', currentPage.value);

  try {
    const res = await fetch(`${WORKER_URL}/api/wiki/submit-archive`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${auth.token}` },
      body: fd
    });
    if (res.ok) {
      alert("提交成功！");
      isEditorOpen.value = false;
    }
  } catch (e) { alert("提交请求失败"); }
  finally { isSubmitting.value = false; }
};

onMounted(() => {
  initAuth();
  loadPage('README.md');
});
</script>

<style>
/* 可以在这里加点你喜欢的暗黑模式微调 */
.scrollbar-hide::-webkit-scrollbar { display: none; }
</style>