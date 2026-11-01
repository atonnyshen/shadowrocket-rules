// Clash Verge Global Extend Script v5.0（2026-11-01 極簡扁平 5 大核心策略組版；對齊 Shadowrocket 成功經驗）
// 重構重點：
//   1. 策略組結構極簡扁平化（徹底收斂為 5 大核心組，無多層巢狀嵌套）：
//      - 🔷 Gemini 專區（fallback）：鎖定純美 02 主力與美國住宅備援，實質出口 100% 固定在美國本土；探針直連 https://gemini.google.com，指定 expected-status: 200，lazy: true。
//      - 🚀 影音高速（url-test）：專門服務 YouTube、Netflix、Threads、Instagram，納入日本、美西、新加坡大頻寬專線，正則嚴格排除 6Mbps 台灣低頻寬小水管。
//      - 🌐 日常瀏覽（fallback / 智慧直連）：整合 Google 搜尋、ChatGPT、Claude、海外通用與 FINAL 兜底，100% 完整保留台灣專線、日本、新加坡、美西、香港全節點，後台自動選路。
//      - 🏛️ 台灣政務（select）：DIRECT 直連優先，備援台灣 HiNet 專線。
//      - 🛑 廣告攔截（select）：REJECT。
//   2. 全面改採 Mihomo 原生 filter 正則匹配（徹底消除硬編碼）：
//      徹底拔除舊版硬編碼之 AI 與 Google 節點陣列、出口城市字典及慢速名單，改用 Mihomo 原生 filter / exclude-filter 正則表達式自動動態匹配節點池，確保機場節點改名或增減時具備 100% 自動相容性。
//   3. 注入 Mihomo 進階效能與穩定性參數：
//      - lazy: true（隨選測速，未連線服務不發起背景探針，大幅降低 CPU 與網路負擔）
//      - tolerance: 100（容差 100ms，徹底杜絕延遲微小浮動引發的頻繁切換斷線）
//      - unified-delay: true 與 tcp-concurrent: true（併發 TCP 握手與精準延遲計算）
//   4. 規則嚴密防禦與順序保證：
//      - YouTube API & CDN (youtubei.googleapis.com, googlevideo.com) 置於 Google 搜尋之前，確保 YouTube 100% 進入 🚀 影音高速。
//      - Gemini、Google AI Studio、NotebookLM、Antigravity 全家桶置於 Google 通用規則之前，確保 100% 進入 🔷 Gemini 專區。
//      - 境內大廠原生 HTTP/3 放行，境外 UDP/443 精準攔截降級 TCP TLS 1.3。
//      - 全域兜底 MATCH 置於全部自訂與訂閱規則之最末，確保基礎分流規則 100% 生效無死規則。

function main(config, profileName) {
    const allProxies = config.proxies || [];
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

    // ---------- 3. 節點池：剔除慢速華南標準中繼、不支援協定與虛擬節點 ----------
    const name = p => String(p.name || "");
    const server = p => String(p.server || "");
    const isRelay = p => /^hn(pro|\.\d+)\./i.test(server(p)) || /tw2\.189\.cn/i.test(server(p));
    const isPseudo = p => /到期|流量|官网|网站|traffic|expire|website/i.test(name(p));
    const isUnsupported = p => p.network === "ws" || /mieru/i.test(String(p.type || "")) || /\*/.test(name(p));
    const isStandardSlow = p => /标准/.test(name(p)) || isRelay(p);

    const validProxies = allProxies.filter(p => !isPseudo(p) && !isUnsupported(p) && !isStandardSlow(p));
    config.proxies = validProxies.length ? validProxies : allProxies.filter(p => !isUnsupported(p) && !isPseudo(p));

    // ---------- 4. 扁平化策略組（收斂為 5 大核心組，對齊 Shadowrocket 成功架構） ----------
    const G = {
        gemini: "🔷 Gemini 專區",
        media: "🚀 影音高速",
        world: "🌐 日常瀏覽",
        tw: "🏛️ 台灣政務",
        ad: "🛑 廣告攔截"
    };

    config["proxy-groups"] = [
        // 1. 🔷 Gemini 專區（fallback）：鎖定純美 02 主力，備援美國住宅；探針直連 https://gemini.google.com
        {
            name: G.gemini,
            type: "fallback",
            url: "https://gemini.google.com",
            "expected-status": 200,
            interval: 300,
            timeout: 5000,
            lazy: true,
            "include-all": true,
            filter: "(?i)(?=.*(美国|US|United States))(?=.*(02|住宅|Residential))",
            "exclude-filter": "(?i)(香港|澳门|澳門|HK|MO|Macau|0[345])"
        },
        // 2. 🚀 影音高速（url-test）：大頻寬日美星港優先，正則嚴格排除 6Mbps 台灣低頻寬小水管
        {
            name: G.media,
            type: "url-test",
            url: "https://www.gstatic.com/generate_204",
            interval: 300,
            timeout: 5000,
            tolerance: 100,
            lazy: true,
            "include-all": true,
            filter: "(?i)(日|JP|Japan|美|US|United States|新|SG|Singapore|港|HK|Hong Kong)",
            "exclude-filter": "(?i)(台|TW|Taiwan)"
        },
        // 3. 🌐 日常瀏覽（fallback / 智慧直連）：整合 Google 搜尋、ChatGPT、Claude、海外通用與 FINAL 兜底，保留全區專線
        {
            name: G.world,
            type: "fallback",
            url: "https://www.gstatic.com/generate_204",
            interval: 300,
            timeout: 5000,
            tolerance: 100,
            lazy: true,
            "include-all": true,
            filter: "(?i)(台|TW|Taiwan|日|JP|Japan|新|SG|Singapore|美|US|United States|港|HK|Hong Kong)"
        },
        // 4. 🏛️ 台灣政務（select）：DIRECT 直連優先，備援台灣專線
        {
            name: G.tw,
            type: "select",
            proxies: ["DIRECT"],
            "include-all": true,
            filter: "(?i)(台|TW|Taiwan)"
        },
        // 5. 🛑 廣告攔截（select）：REJECT
        {
            name: G.ad,
            type: "select",
            proxies: ["REJECT", "DIRECT"]
        }
    ];

    // ---------- 5. 外部訂閱群組重定向 ----------
    const remap = {
        "ChatGPT": G.world,
        "AI": G.world,
        "OpenAI": G.world,
        "Claude": G.world,
        "Gemini": G.gemini,
        "Google": G.world,
        "YouTube": G.media,
        "海外媒体": G.media, "Netflix": G.media, "Disney+": G.media, "Spotify": G.media,
        "Telegram": G.world,
        "节点选择": G.world, "其他分流": G.world, "测速网站": G.world, "自动选择": G.world, "故障转移": G.world, "漏网之鱼": G.world,
        "国内分流": "DIRECT", "国内媒体": "DIRECT", "苹果服务": "DIRECT", "Microsoft": "DIRECT", "Steam": "DIRECT",
        "台湾服务": G.tw,
        "广告过滤": G.ad
    };
    const known = new Set([...config["proxy-groups"].map(g => g.name), "DIRECT", "REJECT", "REJECT-DROP", "PASS"]);
    const retarget = r => {
        const parts = String(r).split(",").map(s => s.trim());
        const idx = parts[parts.length - 1] === "no-resolve" ? parts.length - 2 : parts.length - 1;
        const t = parts[idx];
        parts[idx] = known.has(t) ? t : (remap[t] || G.world);
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

        // 5. 境外 QUIC 攔截（降級為穩定 TCP TLS 1.3）
        "AND,((NETWORK,UDP),(DST-PORT,443)),REJECT",

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
            "cloudaicompanion.googleapis.com", "proactivebackend-pa.googleapis.com", "developerprofiles-pa.googleapis.com"
        ], G.gemini),
        `DOMAIN,antigravity-unleash.goog,${G.gemini}`,
        `DOMAIN-KEYWORD,antigravity,${G.gemini}`,
        `DOMAIN-KEYWORD,cloudcode,${G.gemini}`,
        `DOMAIN-KEYWORD,aicode,${G.gemini}`,
        `GEOSITE,google-gemini,${G.gemini}`,

        // 10. 🌐 日常瀏覽：其他 AI 工作流（OpenAI / ChatGPT / Claude 等通用 AI）
        ...sfx([
            "openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com", "sora.com",
            "anthropic.com", "claude.ai", "claude.com", "clau.de",
            "typeless.com", "typeless-static.com", "groq.com", "deepgram.com", "assemblyai.com", "elevenlabs.io",
            "diabrowser.engineering", "diabrowser.com", "dia.xyz", "thebrowser.company", "arc.net",
            "cursor.sh", "cursor.com", "cursorapi.com", "cursorvm.com", "githubcopilot.com",
            "perplexity.ai", "pplx.ai", "grok.com", "x.ai", "mistral.ai", "cohere.ai", "openrouter.ai", "huggingface.co",
            "genspark.ai", "heygen.ai", "readifyai.com", "immersivetranslate.com", "deepl.com",
            "v0.dev", "bolt.new", "lovable.dev", "replit.com"
        ], G.world),
        `DOMAIN,m365.cloud.microsoft,${G.world}`,
        `GEOSITE,category-ai-!cn,${G.world}`,

        // 11. 🌐 日常瀏覽：Google 搜尋與通用服務
        ...sfx([
            "google.com", "google.com.tw", "google.com.hk", "google.co.jp",
            "googleapis.com", "google.dev", "gstatic.com", "googleusercontent.com",
            "googlecode.com", "gvt1.com", "1e100.net"
        ], G.world),
        `DOMAIN-SUFFIX,goog,${G.world}`,
        `DOMAIN-SUFFIX,google,${G.world}`,
        `DOMAIN,accounts.google.com,${G.world}`,
        `GEOSITE,google,${G.world}`,

        // 12. Apple 推送直連
        ...sfx(["push.apple.com"], "DIRECT"),
        "DOMAIN,identity.apple.com,DIRECT",

        // 13. 通訊（Line / Telegram / WhatsApp 等）
        `GEOSITE,line,${G.world}`,
        `GEOSITE,telegram,${G.world}`,
        `GEOSITE,whatsapp,${G.world}`,
        ...sfx(["line.me", "line-apps.com", "line-scdn.net", "naver.jp", "t.me", "telegram.org",
            "whatsapp.com", "whatsapp.net", "messenger.com", "skype.com", "discord.com", "discord.gg", "discordapp.com"], G.world),

        // 14. 境內 GeoIP 直連
        "GEOIP,cn,DIRECT"
    ];

    const seen = new Set(customRules.map(r => r.toLowerCase()));
    const baseRules = (config["rules"] || [])
        .map(retarget)
        .filter(r => {
            if (!r) return false;
            if (r.toUpperCase().startsWith("MATCH,")) return false;
            return !seen.has(r.toLowerCase());
        });

    // 全域兜底 MATCH 置於全部自訂與訂閱規則之最末，確保基礎分流規則 100% 生效無死規則
    config["rules"] = [...customRules, ...baseRules, `MATCH,${G.world}`];
    return config;
}
