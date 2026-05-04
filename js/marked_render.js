export const setupMarked = (getContext) => {
    // 掩码扩展 !!text!!
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

    // 增强图片扩展支持 wid/heig 参数
    const imageCustomExtension = {
        name: 'imageCustom',
        level: 'inline',
        start(src) { return src.match(/!\[/)?.index; },
        tokenizer(src) {
            const match = /^!\[([\s\S]*?)\]\(([\s\S]*?)\)/.exec(src);
            if (match) return { type: 'imageCustom', raw: match[0], text: match[1], href: match[2] };
        },
        renderer(token) {
            const { previews, baseDir } = getContext();
            const rawHref = token.href || '';
            const widMatch = rawHref.match(/wid=([^ ]+)/);
            const heigMatch = rawHref.match(/heig=([^ ]+)/);
            let cleanHref = rawHref.replace(/wid=[^ ]+/g, '').replace(/heig=[^ ]+/g, '').trim();
            const fileName = cleanHref.split('/').pop();

            let styles = [];
            if (widMatch) styles.push(`width: ${widMatch[1]}`);
            if (heigMatch) styles.push(`height: ${heigMatch[1]}`);

            let src = '';
            if (previews && previews[fileName]) {
                src = previews[fileName];
            } else if (!cleanHref.startsWith('http') && !cleanHref.startsWith('blob:')) {
                const dir = baseDir ? baseDir.replace(/\/$/, '') + '/' : '';
                src = `wiki_content/${dir}${cleanHref.replace(/^\.\//, '')}`;
            } else {
                src = cleanHref;
            }

            return `
            <div class="img-container flex flex-col items-center my-6">
                <img src="${src}" alt="${token.text}" style="${styles.join('; ')}" class="max-w-full rounded-lg shadow-md">
                ${token.text ? `<p class="img-caption text-xs mt-2 opacity-50 italic"># ${token.text}</p>` : ''}
            </div>`;
        }
    };

    marked.use({
        extensions: [maskExtension, imageCustomExtension],
        renderer: {
            code(token) {
                const lang = token.lang || 'plaintext';
                const highlighted = hljs.getLanguage(lang)
                    ? hljs.highlight(token.text, { language: lang }).value
                    : hljs.highlightAuto(token.text).value;
                return `<pre data-lang="${lang.toUpperCase()}"><button class="copy-btn" onclick="window.copyCode(this)">Copy</button><code class="hljs">${highlighted}</code></pre>`;
            }
        },
        gfm: true,
        breaks: true
    });
};