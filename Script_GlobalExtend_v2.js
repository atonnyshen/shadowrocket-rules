// Clash Verge Global Extend Script v5.8（2026-11-12：雙樞紐聯動架構——Gemini 專區與影音高速置頂雙主控，AI 專區純美跟隨防封，日常瀏覽日本大頻寬跟隨）
// v5.8 修正：
//   - 建立雙樞紐聯動架構：前台僅需維護「🔷 Gemini 專區」（美區 AI 主控）與「🚀 影音高速」（日區日常串流主控）兩大入口。
//   - 「🧠 AI 專區」首選動態穿透綁定「🔷 Gemini 專區」，全域 AI 工具出口保證 100% 一致；備援池嚴格限定純美專線，杜絕跳國被封號。
//   - 「🌐 日常瀏覽」首選動態穿透綁定「🚀 影音高速」，常態享用日本一線大頻寬；異常時自動 fallback 至日台星美專線池。
//   - 策略組視覺順序收斂：Gemini 專區與 影音高速 永遠置頂於介面最上方。
// 重構重點：
//   1. 策略組結構扁平化（5 大業務組 ＋ 🧠 AI 專區 ＋ 🍎 APNs 推送，無多層巢狀）：
//      - 🔷 Gemini 專區（select）：出口固定不走自動切換。實測 fallback 會在連線失敗時立即換節點，造成同一 AGY session 出口漂移並觸發 Google 400；預設鎖定大陸優化美國 02，清單順序即人工／watchdog 的補位順序。
//      - 🧠 AI 專區（select）：ChatGPT／Claude／Typeless／Cursor／Turnstile 固定出口，禁止自動換國。
//      - 🍎 APNs 推送（fallback）：代理優先、DIRECT 兜底。
//      - 🚀 影音高速（url-test）：專門服務 YouTube、Netflix、Threads、Instagram，首位靜態鎖定日本 02，納入日港星美大頻寬專線，正則嚴格排除台灣小水管與無效住宅節點。
//      - 🌐 日常與 AI（url-test，整合日常與 AI）：整合 ChatGPT、Claude、Typeless、Cursor、Google 搜尋、海外通用與 FINAL 兜底；正則 100% 物理阻斷香港、澳門、台灣劣質節點與住宅節點，鎖定日美星低延遲專線，完美對齊 Turnstile 人機驗證防 IP 漂移。
//      - 🏛️ 台灣政務（select）：DIRECT 直連優先，備援台灣 HiNet 專線。
//      - 🛑 廣告攔截（select）：REJECT。
//   2. 節點池純淨度與靜態排序保證：
//      - 預處理直接過濾 7 大 100% 全死殭屍節點（阿根廷 01、印度 01、俄羅斯 01、香港優化 06、美國優化 05、日本優化 03、新加坡優化 02），不浪費探針連線。
//      - 執行加權排序（日本 02 得分 100，美國 04 得分 98），保證空窗期首位請求 0 抖動 0 卡頓。
//   3. 注入 Mihomo 進階效能與穩定性參數：
//      - 探針全面標準化為 Google / Cloudflare 原生無盾 generate_204 端點，不設 expected-status。
//      - tolerance: 100（容差 100ms，徹底杜絕延遲微小浮動引發的頻繁切換斷線）。
//      - unified-delay: true 與 tcp-concurrent: true（併發 TCP 握手與精準延遲計算）。
//   4. 規則嚴密防禦與順序保證：
//      - YouTube API & CDN (youtubei.googleapis.com, googlevideo.com) 置於 Google 搜尋之前，確保 YouTube 100% 進入 🚀 影音高速。
//      - Gemini、Google AI Studio、NotebookLM、Antigravity 全家桶置於 Google 通用規則之前，確保 100% 進入 🔷 Gemini 專區。
//      - 境內大廠原生 HTTP/3 放行，境外 UDP/443 精準攔截降級 TCP TLS 1.3。
//      - 全域兜底 MATCH 置於全部自訂與訂閱規則之最末，確保基礎分流規則 100% 生效無死規則。

function main(config, profileName) {
    if (!config || typeof config !== "object") return {};
    const allProxies = Array.isArray(config.proxies) ? config.proxies : [];
    if (allProxies.length === 0) return config;

    // ---------- 1. 基礎參數 ----------
    config["ipv6"] = false;
    config["tcp-concurrent"] = true;
    config["unified-delay"] = true;
    config["keep-alive-interval"] = 15;
    config["keep-alive-idle"] = 15;
    delete config["hosts"];
    if (!config["tun"]) config["tun"] = {};
    config["tun"]["stack"] = "mixed";
    if (!config["profile"]) config["profile"] = {};
    config["profile"]["store-selected"] = true;
    config["profile"]["store-fake-ip"] = true;

    // Geo 資料庫自動更新（GEOSITE 分類會過期，48 小時同步一次）
    config["geo-auto-update"] = true;
    config["geo-update-interval"] = 48;

    // Sniffer（安全模式）：從 TLS SNI / HTTP Host 回收域名，讓自帶 DoH 的 App 也能命中 GEOSITE；
    // override-destination: false 只影響規則比對，不改寫連線目標。
    config["sniffer"] = {
        enable: true,
        "parse-pure-ip": true,
        "override-destination": false,
        sniff: {
            TLS: { ports: [443, 8443] },
            HTTP: { ports: [80, "8080-8880"] },
            QUIC: { ports: [443, 8443] }
        },
        "skip-domain": ["+.push.apple.com", "Mijia Cloud"]
    };

    // ---------- 2. DNS：節點網域防污染 + 境外出國雙路 DoH ----------
    if (!config["dns"]) config["dns"] = {};
    const dns = config["dns"];
    dns["enable"] = true;
    dns["ipv6"] = false;
    dns["respect-rules"] = true;

    const airportDns = ["tcp://51.79.213.90:5353", "https://doh.959918.xyz/dns-query", "https://dns.tshl.de5.net/dns-query"];
    dns["proxy-server-nameserver-policy"] = dns["proxy-server-nameserver-policy"] || {};
    for (const s of ["+.189.cn", "+.tshl.ai", "+.gov.cn"]) dns["proxy-server-nameserver-policy"][s] = airportDns;
    dns["proxy-server-nameserver"] = dns["proxy-server-nameserver"] || ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"];

    // 換網路備援：追加 DHCP 下發的 DNS（iPhone 熱點 172.20.10.1 / 家中路由器），與原上游併發查詢、取先回者
    const dhcpDns = "dhcp://en0";
    for (const k of ["nameserver", "proxy-server-nameserver"]) {
        const list = Array.isArray(dns[k]) ? dns[k] : [];
        if (!list.includes(dhcpDns)) dns[k] = [...list, dhcpDns];
    }

    // 連線檢測、區網與校時網域回真實 IP（飯店／機場登入頁偵測依賴這些）
    const realIpDomains = [
        "+.lan", "+.local", "+.home.arpa", "localhost.ptlogin2.qq.com",
        "captive.apple.com", "+.msftconnecttest.com", "+.msftncsi.com",
        "connectivitycheck.gstatic.com", "connectivitycheck.android.com", "detectportal.firefox.com",
        "time.apple.com", "time.*.com", "ntp.*.com", "+.pool.ntp.org"
    ];
    const fakeIpFilter = Array.isArray(dns["fake-ip-filter"]) ? dns["fake-ip-filter"] : [];
    dns["fake-ip-filter"] = [...fakeIpFilter, ...realIpDomains.filter(d => !fakeIpFilter.includes(d))];

    dns["nameserver-policy"] = dns["nameserver-policy"] || {};
    const foreignDoh = ["https://dns.google/dns-query", "https://cloudflare-dns.com/dns-query"];
    for (const s of [
        "+.gov.tw", "+.gov.taipei", "+.mil.tw", "+.edu.tw",
        "+.ytimg.com", "+.ggpht.com", "sponsor.ajay.app"
    ]) {
        dns["nameserver-policy"][s] = foreignDoh;
    }

    // ---------- 3. 節點池：剔除慢速標準中繼、7 大全死節點、不支援協定與虛擬節點 ----------
    const name = p => (p && typeof p === "object" ? String(p.name || "") : "");
    const server = p => (p && typeof p === "object" ? String(p.server || "") : "");
    const isRelay = p => /^hn(pro|\.\d+)\./i.test(server(p)) || /tw2\.189\.cn/i.test(server(p));
    const isPseudo = p => /到期|流量|官网|网站|traffic|expire|website/i.test(name(p));
    const isUnsupported = p => !p || typeof p !== "object" || p.network === "ws" || /mieru/i.test(String(p.type || "")) || /\*/.test(name(p));
    const isStandardSlow = p => /标准/.test(name(p)) || isRelay(p);
    const isDead = p => {
        const n = name(p);
        return /阿根廷 01|印度 01|俄罗斯 01/i.test(n) ||
               /大陆优化.*(香港 06|美国 05|日本 03|新加坡 02)/i.test(n);
    };

    const validProxies = allProxies.filter(p => !isUnsupported(p) && !isPseudo(p) && !isStandardSlow(p) && !isDead(p));
    const finalProxies = validProxies.length ? validProxies : allProxies.filter(p => !isUnsupported(p) && !isPseudo(p));

    // 加權靜態排序：日本 02 置頂供影音組初始順序參考；Gemini 組另有專屬排序（見第 4 節）
    finalProxies.sort((a, b) => {
        const na = name(a), nb = name(b);
        const getScore = n => {
            if (/日本 02/i.test(n)) return 100;
            if (/大陆优化.*美国 02/i.test(n)) return 95;
            if (/大陆优化.*美国 0[134]/i.test(n)) return 90;
            if (/华南专线.*美国 02/i.test(n)) return 85;
            if (/华南专线.*日本/i.test(n)) return 80;
            if (/新加坡/i.test(n)) return 75;
            if (/台湾/i.test(n)) return 50;
            if (/香港/i.test(n)) return 40;
            if (/住宅|Residential/i.test(n)) return 10;
            return 60;
        };
        const sa = getScore(na), sb = getScore(nb);
        if (sa !== sb) return sb - sa;
        return na.localeCompare(nb);
    });
    config.proxies = finalProxies;

    // ---------- 4. 雙樞紐聯動策略組（以 Gemini 專區與 影音高速 為雙主控樞紐） ----------
    const G = {
        gemini: "🔷 Gemini 專區",
        media: "🚀 影音高速",
        ai: "🧠 AI 專區",
        world: "🌐 日常瀏覽",
        tw: "🏛️ 台灣政務",
        ad: "🛑 廣告攔截"
    };

    // 動態正則精確過濾與順序保證（徹底消除底層字典序將香港或劣質節點推到首位造成的初次卡頓）
    const pNames = list => list.map(p => name(p));
    const isGemini = p => /(?=.*(美国|US|United States))(?=.*0[1234])/i.test(name(p)) && !/(香港|澳门|澳門|HK|MO|Macau|05|住宅|Residential|华南专线.*美国 02)/i.test(name(p));
    const isMedia = p => /(日|JP|Japan|港|HK|Hong Kong|新|SG|Singapore|美|US|United States)/i.test(name(p)) && !/(台|TW|Taiwan|住宅|Residential)/i.test(name(p));
    const isWorld = p => /(日|JP|Japan|新|SG|Singapore|美|US|United States|台|TW|Taiwan)/i.test(name(p)) && !/(香港|澳门|澳門|HK|MO|Macau|住宅|Residential)/i.test(name(p));
    const isTW = p => /(台|TW|Taiwan)/i.test(name(p));

    // Gemini 專屬排序：02 實測最穩（AGY 31s 成功），01/03 次之，04 曾有 120s 逾時故置末位
    const geminiRank = n => {
        if (/大陆优化.*美国 02/i.test(n)) return 0;
        if (/华南专线.*美国 02/i.test(n)) return 1;
        if (/大陆优化.*美国 01/i.test(n)) return 2;
        if (/华南专线.*美国 01/i.test(n)) return 3;
        if (/大陆优化.*美国 03/i.test(n)) return 4;
        if (/华南专线.*美国 03/i.test(n)) return 5;
        if (/美国 04/i.test(n)) return 6;
        return 7;
    };

    const geminiProxies = pNames(finalProxies.filter(isGemini)).sort((a, b) => geminiRank(a) - geminiRank(b));
    const mediaProxies = pNames(finalProxies.filter(isMedia));

    // AI 專區：首選動態穿透綁定「🔷 Gemini 專區」，備援池嚴格限定純美專線（絕對物理排除非美節點，杜絕跳國被封號）
    const usBackupProxies = geminiProxies.filter(n => !n.includes("美国 02"));
    const aiProxies = [G.gemini, ...(usBackupProxies.length ? usBackupProxies : ["DIRECT"])];

    // 日常瀏覽：首選動態穿透綁定「🚀 影音高速」（享用日本一線大頻寬），備援池為日台星美專線池
    const worldBackupProxies = pNames(finalProxies.filter(isWorld));
    const worldProxies = [G.media, ...(worldBackupProxies.length ? worldBackupProxies : ["DIRECT"])];

    const twProxies = ["DIRECT", ...pNames(finalProxies.filter(isTW))];

    // ---------- 4.5 APNs 推送（2026-05 蘋果對大陸 IP 過濾海外 App 推送）----------
    // fallback：影音高速健康時走代理，節點故障時回落 DIRECT，避免國內 App 推送一起失聯。
    const apnsGroup = {
        name: "🍎 APNs 推送",
        type: "fallback",
        proxies: [G.media, "DIRECT"],
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
        timeout: 5000
    };

    config["proxy-groups"] = [
        // ⭐ 1. 🔷 Gemini 專區（樞紐 1：全域 AI 核心出口，手動 Select）
        //    預設鎖定大陸優化美國 02，長會話出口固定，清單順序即容災與人工補位順序。
        {
            name: G.gemini,
            type: "select",
            proxies: geminiProxies.length ? geminiProxies : ["DIRECT"]
        },
        // ⭐ 2. 🚀 影音高速（樞紐 2：全域串流與日常高速出口，自動 URLTest）
        //    大頻寬日港星美優先，首位靜態鎖定日本 02，排除台灣低頻寬小水管與住宅節點。
        {
            name: G.media,
            type: "url-test",
            url: "https://www.gstatic.com/generate_204",
            interval: 180,
            timeout: 2500,
            tolerance: 100,
            lazy: false,
            proxies: mediaProxies.length ? mediaProxies : ["DIRECT"]
        },
        // 3. 🧠 AI 專區（跟隨組 1：首選跟隨 Gemini 專區，保持全域 AI 工具出口一致）
        //    採用 fallback 容災，平常 100% 走 Gemini 專區；故障時僅回落至純美備援池，絕不跨國。
        {
            name: G.ai,
            type: "fallback",
            url: "https://www.gstatic.com/generate_204",
            interval: 300,
            timeout: 2500,
            proxies: aiProxies
        },
        // 4. 🌐 日常瀏覽（跟隨組 2：首選跟隨 影音高速，享用日本專線大頻寬）
        //    採用 fallback 容災，平常跟隨影音高速；故障時回退至日台星美專線池。
        {
            name: G.world,
            type: "fallback",
            url: "https://cp.cloudflare.com/generate_204",
            interval: 300,
            timeout: 2500,
            proxies: worldProxies
        },
        // 5. 🏛️ 台灣政務（select）：DIRECT 直連優先，備援台灣專線
        {
            name: G.tw,
            type: "select",
            proxies: twProxies.length ? twProxies : ["DIRECT"]
        },
        // 6. 🍎 APNs 推送（fallback）：置於被動基礎設施區
        apnsGroup,
        // 7. 🛑 廣告攔截（select）：REJECT
        {
            name: G.ad,
            type: "select",
            proxies: ["REJECT", "DIRECT"]
        }
    ];


    // ---------- 5. 外部訂閱群組重定向 ----------
    const remap = {
        "ChatGPT": G.ai,
        "AI": G.ai,
        "OpenAI": G.ai,
        "Claude": G.ai,
        "Gemini": G.gemini,
        "Google": G.world,
        "YouTube": G.media,
        "海外媒体": G.media, "Netflix": G.media, "Disney+": G.media, "Spotify": G.media,
        "Telegram": G.world,
        "节点选择": G.world, "其他分流": G.world, "测速网站": G.world, "自动选择": G.world, "故障转移": G.world, "漏网之鱼": G.world,
        "国内分流": "DIRECT", "国内媒体": "DIRECT", "苹果服务": "DIRECT", "Microsoft": "DIRECT", "Steam": "DIRECT",
        "台湾服务": G.tw,
        "广告过滤": G.ad,
        "广告拦截": G.ad
    };
    const remapLower = Object.fromEntries(Object.entries(remap).map(([k, v]) => [k.toLowerCase(), v]));
    const known = new Set([...config["proxy-groups"].map(g => g.name), "DIRECT", "REJECT", "REJECT-DROP", "PASS"]);

    const cleanRuleStr = r => (typeof r === "string" ? r.replace(/\s*(?:#|\/\/|;).*$/, "").trim() : "");
    const isRuleValid = r => {
        if (!r || typeof r !== "string") return false;
        const cleaned = cleanRuleStr(r);
        if (!cleaned || cleaned.startsWith("#") || cleaned.startsWith("//") || cleaned.startsWith(";")) return false;
        return cleaned.includes(",");
    };
    const retarget = r => {
        if (!isRuleValid(r)) return null;
        const cleaned = cleanRuleStr(r);
        if (cleaned.toUpperCase().startsWith("MATCH,")) return null;
        const parts = cleaned.split(",").map(s => s.trim());
        const lastPart = parts[parts.length - 1].toLowerCase();
        const isNoResolve = lastPart === "no-resolve";
        // 非 MATCH 規則至少要有 TYPE、VALUE 與 TARGET（若有 no-resolve 則至少 4 個欄位）
        const idx = isNoResolve ? parts.length - 2 : parts.length - 1;
        if (idx < 2) return null;
        const t = parts[idx];
        const tUpper = t.toUpperCase();
        if (["DIRECT", "REJECT", "REJECT-DROP", "PASS"].includes(tUpper)) {
            parts[idx] = tUpper;
        } else if (known.has(t)) {
            parts[idx] = t;
        } else {
            const tLower = t.toLowerCase();
            parts[idx] = remapLower[tLower] || G.world;
        }
        return parts.join(",");
    };

    // ---------- 6. 分流規則（依序嚴格匹配） ----------
    const sfx = (list, target) => list.map(d => `DOMAIN-SUFFIX,${d},${target}`);
    const customRules = [
        // 0. 本機回環與本機服務（保護所有 IDE / VS Code / OAuth localhost 回呼）
        "DOMAIN,localhost,DIRECT",
        "DOMAIN-SUFFIX,localhost,DIRECT",
        "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
        "IP-CIDR6,::1/128,DIRECT,no-resolve",
        "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
        "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
        "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
        "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
        "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve",

        // 1. 自救直連（永遠置頂）
        "DOMAIN,api.tshl.cc,DIRECT",
        "IP-CIDR,51.79.213.90/32,DIRECT,no-resolve",

        // 2. 私有網段
        "GEOSITE,private,DIRECT",
        "GEOIP,private,DIRECT,no-resolve",

        // 3. 廣告攔截
        `GEOSITE,category-ads-all,${G.ad}`,
        ...sfx(["cm.bilibili.com", "ad.bilibili.com", "cm.adcommon.bilibili.com", "cm.game.bilibili.com",
            "cm.track.biligame.bilibili.com", "pcdn.biliapi.net"], G.ad),
        `DOMAIN,data.bilibili.com,${G.ad}`,
        `DOMAIN-KEYWORD,biliad,${G.ad}`,
        `DOMAIN-WILDCARD,*pcdn*.biliapi.net,${G.ad}`,

        // 4. 境內直連先行（保留國內原生 HTTP/3 / QUIC 高速吞吐）
        ...sfx(["bilibili.com", "bilivideo.com", "hdslb.com", "weixin.com", "wechat.com", "qq.com",
            "alipay.com", "taobao.com", "jd.com", "baidu.com", "12306.cn", "meituan.com"], "DIRECT"),
        "GEOSITE,cn,DIRECT",
        "GEOSITE,category-ai-cn,DIRECT",

        // 5. 境外 QUIC 攔截（降級為穩定 TCP TLS 1.3）
        "AND,((NETWORK,UDP),(DST-PORT,443)),REJECT",

        // 5.5 APNs 推送（IP 條必須排在訂閱 IP-CIDR,17.0.0.0/8,DIRECT 之前）
        `DOMAIN,identity.apple.com,${apnsGroup.name}`,
        `DOMAIN-SUFFIX,push.apple.com,${apnsGroup.name}`,
        `DOMAIN-SUFFIX,akadns.net,${apnsGroup.name}`,
        `DOMAIN-KEYWORD,apple.com.edgekey.net,${apnsGroup.name}`,
        `IP-CIDR,17.188.128.0/18,${apnsGroup.name},no-resolve`,
        `IP-CIDR,17.188.20.0/23,${apnsGroup.name},no-resolve`,
        `IP-CIDR,17.249.0.0/16,${apnsGroup.name},no-resolve`,
        `IP-CIDR,17.252.0.0/16,${apnsGroup.name},no-resolve`,
        `IP-CIDR,17.57.144.0/22,${apnsGroup.name},no-resolve`,

        // 6. 台灣政務與金融
        ...sfx(["gov.tw", "gov.taipei", "mil.tw", "edu.tw", "hinet.net", "cht.com.tw", "tradevan.com.tw",
            "fisc.com.tw", "ba.org.tw", "taipower.com.tw", "thsrc.com.tw"], G.tw),

        // 7. YouTube 影音與串流（優先於 Google 規則，鎖定大頻寬）
        `DOMAIN-SUFFIX,youtubei.googleapis.com,${G.media}`,
        `DOMAIN-SUFFIX,googlevideo.com,${G.media}`,
        `DOMAIN-SUFFIX,youtube.com,${G.media}`,
        `DOMAIN-SUFFIX,youtu.be,${G.media}`,
        `DOMAIN-SUFFIX,ytimg.com,${G.media}`,
        `DOMAIN-SUFFIX,ggpht.com,${G.media}`,
        `DOMAIN,sponsor.ajay.app,${G.world}`,
        `GEOSITE,youtube,${G.media}`,

        // 8. 影音社群（Threads / Instagram / Meta / Twitter / Netflix / Disney+ / Spotify / Twitch / Reddit）
        `GEOSITE,netflix,${G.media}`,
        `GEOSITE,instagram,${G.media}`,
        `GEOSITE,facebook,${G.media}`,
        `GEOSITE,meta,${G.media}`,
        `GEOSITE,twitter,${G.media}`,
        `GEOSITE,spotify,${G.media}`,
        ...sfx([
            "netflix.com", "netflix.net", "nflximg.net", "nflxvideo.net", "nflxext.com", "nflxso.net",
            "threads.net", "threads.com", "instagram.com", "cdninstagram.com",
            "facebook.com", "fbcdn.net", "facebook.net", "meta.com", "fbsbx.com",
            "x.com", "twitter.com", "twimg.com", "disneyplus.com", "spotify.com",
            "scdn.co", "twitch.tv", "reddit.com", "redd.it"
        ], G.media),

        // 9. 🔷 Gemini 專區（Gemini / Google AI Studio / NotebookLM / Antigravity 純美出口防風控）
        ...sfx([
            "antigravity.google", "ai.google.dev", "idx.google.dev", "projectidx.google.dev",
            "gemini.google.com", "aistudio.google.com", "notebooklm.google.com", "notebooklm.google",
            "deepmind.google", "bard.google.com", "labs.google",
            "aicode.googleapis.com", "cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com",
            "aiplatform.googleapis.com", "generativelanguage.googleapis.com", "alkalimakersuite-pa.googleapis.com",
            "cloudaicompanion.googleapis.com", "proactivebackend-pa.googleapis.com", "developerprofiles-pa.googleapis.com",
            "jetski-webchannel.googleapis.com"
        ], G.gemini),
        // 2026-08-28 Copilot session 25510bb4 的結論：AGY 的 OAuth／signaler／play 等
        // googleapis 子域若走另一個出口，會與 cloudcode-pa 的出口不一致而觸發 400；
        // 當時以 googleapis.com 毛毯規則修正。v5.4 只列個別子域，等於把這個洞挖回來。
        `DOMAIN-SUFFIX,googleapis.com,${G.gemini}`,
        `DOMAIN,accounts.google.com,${G.gemini}`,
        `DOMAIN,antigravity-unleash.goog,${G.gemini}`,
        `DOMAIN-SUFFIX,antigravity-unleash.goog,${G.gemini}`,
        `DOMAIN-KEYWORD,antigravity,${G.gemini}`,
        `DOMAIN-KEYWORD,cloudcode,${G.gemini}`,
        `DOMAIN-KEYWORD,aicode,${G.gemini}`,
        `DOMAIN-KEYWORD,jetski,${G.gemini}`,
        `GEOSITE,google-gemini,${G.gemini}`,

        // 10. 🧠 AI 專區（OpenAI / ChatGPT / Claude / Typeless / Cursor / Perplexity 等；固定出口）
        ...sfx([
            "openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com", "sora.com",
            "anthropic.com", "claude.ai", "claude.com", "clau.de",
            "typeless.com", "typeless-static.com", "groq.com", "deepgram.com", "assemblyai.com", "elevenlabs.io",
            "diabrowser.engineering", "diabrowser.com", "dia.xyz", "thebrowser.company", "arc.net",
            "cursor.sh", "cursor.com", "cursorapi.com", "cursorvm.com", "githubcopilot.com",
            "perplexity.ai", "pplx.ai", "grok.com", "x.ai", "mistral.ai", "cohere.ai", "openrouter.ai", "huggingface.co",
            "genspark.ai", "heygen.ai", "readifyai.com", "immersivetranslate.com", "deepl.com",
            "v0.dev", "bolt.new", "lovable.dev", "replit.com", "lovart.ai",
            "arkoselabs.com", "client-api.arkoselabs.com", "openai-api.arkoselabs.com",
            "statsig.com", "statsigapi.net", "featuregates.org",
            "livekit.cloud", "turn.livekit.cloud", "webrtc.livekit.cloud"
        ], G.ai),
        `DOMAIN,challenges.cloudflare.com,${G.ai}`,
        `DOMAIN-SUFFIX,challenges.cloudflare.com,${G.ai}`,
        `GEOSITE,category-ai-!cn,${G.ai}`,
        `GEOSITE,openai,${G.ai}`,
        `GEOSITE,anthropic,${G.ai}`,

        // 11. 🌐 日常瀏覽：Google 搜尋與通用服務（排他性收斂：googleapis 嚴格歸屬 Gemini 專區，此處僅放通用服務）
        ...sfx([
            "google.com", "google.com.tw", "google.com.hk", "google.co.jp",
            "google.dev", "gstatic.com", "googleusercontent.com",
            "googlecode.com", "gvt1.com", "1e100.net"
        ], G.world),
        `DOMAIN-SUFFIX,goog,${G.world}`,
        `DOMAIN-SUFFIX,google,${G.world}`,
        `DOMAIN,m365.cloud.microsoft,${G.world}`,
        `GEOSITE,google,${G.world}`,

        // 12. 通訊（Line / Telegram / WhatsApp 等）
        `GEOSITE,line,${G.world}`,
        `GEOSITE,telegram,${G.world}`,
        `GEOSITE,whatsapp,${G.world}`,
        ...sfx(["line.me", "line-apps.com", "line-scdn.net", "naver.jp", "t.me", "telegram.org",
            "whatsapp.com", "whatsapp.net", "messenger.com", "skype.com", "discord.com", "discord.gg", "discordapp.com"], G.world),

        // 13. 境內 GeoIP 直連（防範境內外網域查詢 DNS 阻塞）
        "GEOIP,cn,DIRECT,no-resolve"
    ];

    const seen = new Set(customRules.map(r => r.toLowerCase()));
    const baseRules = [];
    const rawRules = Array.isArray(config["rules"]) ? config["rules"] : [];
    for (const raw of rawRules) {
        const rewritten = retarget(raw);
        if (!rewritten) continue;
        const lower = rewritten.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            baseRules.push(rewritten);
        }
    }

    // 全域兜底 MATCH 置於全部自訂與訂閱規則之最末，確保基礎分流規則 100% 生效無死規則
    config["rules"] = [...customRules, ...baseRules, `MATCH,${G.world}`];
    return config;
}
