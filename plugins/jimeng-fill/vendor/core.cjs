(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.JimengCore = api; root.DoubaoCore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KINDS = ['角色', '场景', '道具'];
  const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp|avif|heic|tiff?)$/i;
  const EMPTY_ASSET = /^(?:无|暂无|无独立(?:关键)?道具|无关键道具|无独立资产|无需(?:参考图|道具)|不需要(?:参考图|道具)|none|n\/a|—|-)$/i;

  function stem(value) {
    return String(value == null ? '' : value).split(/[\\/]/).pop().replace(IMAGE_EXTENSION, '');
  }

  // Keep the whole qualifier: 白裙回忆, 日景 and 夜景 are different assets.
  function normalizeName(value) {
    return stem(value).normalize('NFKC')
      .replace(/[【〔［\[｛{（(]/g, '[')
      .replace(/[】〕］\]｝}）)]/g, ']')
      .replace(/\s+/gu, '')
      .toLocaleLowerCase('en-US');
  }

  function splitNames(value) {
    const parts = [];
    let buffer = '', depth = 0;
    for (const char of String(value)) {
      if ('【[（(〔{'.includes(char)) depth++;
      if ('】]）)〕}'.includes(char)) depth = Math.max(0, depth - 1);
      if (depth === 0 && /[、，,；;|\n]/u.test(char)) {
        if (buffer.trim()) parts.push(buffer.trim());
        buffer = '';
      } else buffer += char;
    }
    if (buffer.trim()) parts.push(buffer.trim());
    return [...new Set(parts.map(name => name.replace(/^[•·]\s*/u, '').trim()).filter(Boolean))];
  }

  function extractRefs(prompt) {
    const refs = [];
    const seen = new Set();
    const field = /^[\t ]*(?:【(角色|人物|场景|道具)】|\[(角色|人物|场景|道具)\]|(角色|人物|场景|道具)[：:])[\t ]*([^\n]*)/gm;
    let match;
    while ((match = field.exec(prompt))) {
      const originalKind = match[1] || match[2] || match[3];
      const kind = originalKind === '人物' ? '角色' : originalKind;
      for (const name of splitNames(match[4])) {
        const key = kind + ':' + name;
        if (!seen.has(key)) {
          refs.push({ kind, name });
          seen.add(key);
        }
      }
    }
    return refs;
  }

  function numberFrom(value) {
    return value !== undefined && value !== null && /^\d+$/.test(String(value)) ? Number(value) : null;
  }

  function durationFromHeading(title) {
    const text = String(title || '');
    const paren = /[（(][\t ]*(\d+)[\t ]*(?:秒|[sS])[）)]/.exec(text);
    if (paren) {
      const seconds = Number(paren[1]);
      return seconds > 0 && seconds <= 600 ? seconds : null;
    }
    const bare = /分镜[\t ]*\d+[\t ]*[-‐‑–—－][\t ]*\d+[\t ]+(\d+)[\t ]*(?:秒|[sS])\b/.exec(text);
    if (bare) {
      const seconds = Number(bare[1]);
      return seconds > 0 && seconds <= 600 ? seconds : null;
    }
    return null;
  }

  function makeTask(prompt, index, meta) {
    const information = meta || {};
    const episode = numberFrom(information.episode);
    const shot = numberFrom(information.shot);
    const sourceId = String(information.id || (episode !== null && shot !== null ? episode + '-' + shot : 'task-' + (index + 1)));
    const refs = extractRefs(prompt);
    const title = information.title || (episode !== null && shot !== null ? '分镜' + episode + '-' + shot : '任务' + (index + 1));
    const suggested = information.suggestedDuration != null ? numberFrom(information.suggestedDuration) : durationFromHeading(title);
    return {
      id: sourceId,
      sourceId,
      title,
      episode,
      shot,
      prompt,
      refs,
      suggestedDuration: suggested != null && suggested > 0 && suggested <= 600 ? suggested : null,
      validationErrors: prompt.trim() ? [] : ['任务提示词为空。']
    };
  }

  function validateTasks(tasks, warnings, structured) {
    const byId = new Map();
    for (const task of tasks) {
      const group = byId.get(task.sourceId) || [];
      group.push(task);
      byId.set(task.sourceId, group);
      if (structured && !task.refs.length) {
        task.validationErrors.push('未识别到资产头。请检查【角色】【场景】【道具】及其内容。');
        warnings.push(task.title + '：未识别到资产声明，请补齐后再自动填图。');
      }
      for (const kind of KINDS) {
        if (structured && kind !== '道具' && !task.refs.some(ref => ref.kind === kind)) {
          warnings.push(task.title + '：没有“' + kind + '”声明，请在预览中核对。');
          task.validationErrors.push('缺少“' + kind + '”资产声明；请列明资产名，确无该类资产时明确写“无”。');
        }
      }
    }
    const reservedIds = new Set(tasks.map(task => task.id));
    for (const [sourceId, group] of byId) {
      if (group.length > 1) {
        warnings.push('分镜或任务编号重复：' + sourceId + '（' + group.length + ' 条），已暂停这些任务。');
        group.forEach((task, index) => {
          if (index > 0) {
            let ordinal = index + 1;
            let candidate;
            do { candidate = sourceId + '__duplicate_' + ordinal++; } while (reservedIds.has(candidate));
            task.id = candidate;
            reservedIds.add(candidate);
          }
          task.validationErrors.push('编号重复：' + sourceId + '。请修正编号后重新解析。');
        });
      }
    }
    return { tasks, warnings: [...new Set(warnings)] };
  }

  function parseJson(text) {
    let value;
    try { value = JSON.parse(text); } catch (_) { return null; }
    const rows = Array.isArray(value) ? value : value && (value.tasks || value.shots);
    if (!Array.isArray(rows)) return null;
    const warnings = [];
    const tasks = rows.map((row, index) => {
      if (typeof row === 'string') return makeTask(row, index);
      if (!row || typeof row !== 'object') return makeTask('', index);
      const prompt = typeof row.prompt === 'string' ? row.prompt : typeof row.text === 'string' ? row.text : typeof row.content === 'string' ? row.content : '';
      const task = makeTask(prompt, index, row);
      if (Array.isArray(row.refs)) {
        task.refs = row.refs.filter(ref => ref && typeof ref.name === 'string' && ref.name.trim()).map(ref => ({
          kind: ref.kind === '人物' ? '角色' : (KINDS.includes(ref.kind) ? ref.kind : '道具'), name: ref.name.trim()
        }));
      }
      return task;
    });
    if (!tasks.length) warnings.push('JSON 中没有任务。');
    return validateTasks(tasks, warnings, false);
  }

  function parseText(input) {
    const text = String(input == null ? '' : input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!text.trim()) return { tasks: [], warnings: ['没有可解析的文本。'] };
    if (/^[\s]*[\[{]/.test(text)) {
      const json = parseJson(text);
      if (json) return json;
    }
    const warnings = [];
    // Only standalone task headings delimit tasks; dialogue and shot prose do not.
    // 标题后缀可带（20秒）/(8s)/20秒，也可带冒号说明。
    const heading = /^[\t ]*(?:#{1,6}[\t ]*)?(?:(?:剧情|任务)[\t ]*(\d+)[\t ]*[:：][\t ]*)?分镜[\t ]*(\d+)[\t ]*[-‐‑–—－][\t ]*(\d+)[\t ]*(?:[（(][\t ]*\d+[\t ]*(?:秒|[sS])[）)]|[\t ]+\d+[\t ]*(?:秒|[sS])|(?:[：:][^\n]*))?[\t ]*$/gm;
    const headings = [...text.matchAll(heading)];
    const structured = /^(?:[\t ]*)(?:【(?:角色|人物|场景|道具)】|\[(?:角色|人物|场景|道具)\]|(?:角色|人物|场景|道具)[：:])/m.test(text);
    let tasks;
    if (headings.length) {
      const prefix = text.slice(0, headings[0].index).trim();
      if (prefix) warnings.push('首个分镜前有 ' + prefix.length + ' 字说明，未作为生成任务；请检查原文前言。');
      tasks = headings.map((match, index) => {
        const prompt = text.slice(match.index, index + 1 < headings.length ? headings[index + 1].index : text.length).trim();
        const title = match[0].trim();
        return makeTask(prompt, index, { episode: match[2], shot: match[3], title, suggestedDuration: durationFromHeading(title) });
      });
    } else {
      const genericHeading = /^[\t ]*(?:#{1,6}[\t ]*)?(?:剧情|任务|提示词)[\t ]*(\d+)[\t ]*[:：][^\n]*$/gm;
      const generic = [...text.matchAll(genericHeading)];
      if (generic.length) {
        if (text.slice(0, generic[0].index).trim()) warnings.push('首个任务前的说明未作为生成任务，请检查原文前言。');
        tasks = generic.map((match, index) => makeTask(text.slice(match.index, index + 1 < generic.length ? generic[index + 1].index : text.length).trim(), index, { id: 'task-' + match[1], title: match[0].trim() }));
      } else {
        const chunks = text.split(/^[\t ]*(?:-{3,}|={3,})[\t ]*$/m).map(chunk => chunk.trim()).filter(Boolean);
        tasks = chunks.map((chunk, index) => makeTask(chunk, index));
        warnings.push(chunks.length > 1 ? '按独立分隔线拆成 ' + chunks.length + ' 条任务，请核对预览。' : '未发现分镜标题，整段作为 1 条任务，请先核对预览。');
        if (!structured) warnings.push('未发现资产头；当前为纯文字任务。如需参考图，请补充【角色】【场景】【道具】。');
      }
    }
    return validateTasks(tasks, warnings, structured);
  }

  function matchAssets(tasks, assets, overrides, options) {
    const rows = Array.isArray(assets) ? assets.filter(asset => asset && asset.id !== undefined && typeof asset.name === 'string') : [];
    const manual = overrides && typeof overrides === 'object' ? overrides : {};
    const optionalKinds = new Set(options && Array.isArray(options.optionalKinds) ? options.optionalKinds : ['道具']);
    const exactIndex = new Map(), normalizedIndex = new Map(), byId = new Map();
    for (const asset of rows) {
      byId.set(String(asset.id), asset);
      const exact = stem(asset.name);
      const normalized = normalizeName(asset.name);
      if (!exactIndex.has(exact)) exactIndex.set(exact, []);
      if (!normalizedIndex.has(normalized)) normalizedIndex.set(normalized, []);
      exactIndex.get(exact).push(asset);
      normalizedIndex.get(normalized).push(asset);
    }
    return (Array.isArray(tasks) ? tasks : []).map(task => {
      const matches = (Array.isArray(task.refs) ? task.refs : extractRefs(task.prompt || '')).map(ref => {
        const key = ref.kind + ':' + ref.name;
        const result = { kind: ref.kind, name: ref.name, status: 'missing', candidates: [], optional: optionalKinds.has(ref.kind) };
        if (EMPTY_ASSET.test(ref.name.trim())) return { ...result, status: 'ignored' };
        if (Object.prototype.hasOwnProperty.call(manual, key)) {
          const asset = byId.get(String(manual[key]));
          if (asset) return { ...result, status: 'manual', assetId: asset.id, candidates: [asset.id] };
          return { ...result, reason: '手动指定的资产不存在，请重新选择。' };
        }
        let candidates = exactIndex.get(stem(ref.name)) || [];
        let status = 'exact';
        if (!candidates.length) {
          candidates = normalizedIndex.get(normalizeName(ref.name)) || [];
          status = 'normalized';
        }
        if (candidates.length === 1) return { ...result, status, assetId: candidates[0].id, candidates: [candidates[0].id] };
        if (candidates.length > 1) return { ...result, status: 'ambiguous', candidates: candidates.map(asset => asset.id) };
        return result;
      });
      const validationErrors = Array.isArray(task.validationErrors) ? task.validationErrors : [];
      const ready = Boolean((task.prompt || '').trim()) && !validationErrors.length && matches.every(match => match.optional || ['exact', 'normalized', 'manual', 'ignored'].includes(match.status));
      return { ...task, matches, ready };
    });
  }

  function summarize(tasks) {
    const rows = Array.isArray(tasks) ? tasks : [];
    const summary = { total: rows.length, ready: 0, blocked: 0, refs: 0, exact: 0, normalized: 0, manual: 0, missing: 0, ambiguous: 0, ignored: 0, validationErrors: 0, uniqueAssets: 0 };
    const unique = new Set();
    for (const task of rows) {
      if (task.ready) summary.ready++; else summary.blocked++;
      summary.validationErrors += (task.validationErrors || []).length;
      for (const match of task.matches || []) {
        summary.refs++;
        if (Object.prototype.hasOwnProperty.call(summary, match.status)) summary[match.status]++;
        if (match.assetId !== undefined) unique.add(String(match.assetId));
      }
    }
    summary.uniqueAssets = unique.size;
    return summary;
  }

  return Object.freeze({ parseText, matchAssets, summarize, normalizeName, extractRefs, splitNames });
});
