import asyncio
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, BrowserConfig

async def main():
    url = "https://www.douyin.com/jingxuan?modal_id=7671590967870262543"
    
    browser_config = BrowserConfig(
        headless=True,
        viewport={"width": 1280, "height": 800},
        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    )
    
    config = CrawlerRunConfig(
        word_count_threshold=3,
        excluded_tags=["nav", "footer", "aside", "script", "style", "noscript"],
        wait_until="domcontentloaded",          # 不等 networkidle
        page_timeout=60000,                     # 60s
        delay_before_return_html=5.0,           # 多等 5s 让 JS 渲染
        js_code=[
            "await new Promise(r => setTimeout(r, 3000));",
            "window.scrollTo(0, document.body.scrollHeight / 3);",
            "await new Promise(r => setTimeout(r, 2000));",
            "window.scrollTo(0, document.body.scrollHeight * 2 / 3);",
            "await new Promise(r => setTimeout(r, 2000));",
            "window.scrollTo(0, document.body.scrollHeight);",
            "await new Promise(r => setTimeout(r, 2000));",
        ],
        screenshot=True,
    )

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=config)

        print(f"✅ success={result.success}  status={result.status_code}")

        if result.metadata:
            print("\n📋 元数据:")
            for k, v in result.metadata.items():
                if v:
                    print(f"  {k}: {v}")

        md = result.markdown or ""
        if md:
            print(f"\n📝 Markdown ({len(md)} chars):")
            print(md[:8000])
            if len(md) > 8000:
                print(f"\n… 还有 {len(md)-8000} 字符，已截断")
        else:
            print("\n⚠️ Markdown 为空")

        if result.links:
            internal = result.links.get("internal", [])
            external = result.links.get("external", [])
            print(f"\n🔗 链接: 内部 {len(internal)}, 外部 {len(external)}")
            for lnk in (internal + external)[:10]:
                text = lnk.get("text", "")[:60] if isinstance(lnk, dict) else str(lnk)[:60]
                href = lnk.get("href", "") if isinstance(lnk, dict) else ""
                print(f"  • {text} → {href}")

        if result.screenshot:
            with open("/Users/a1412/Desktop/Joker/douyin_screenshot.png", "wb") as f:
                f.write(result.screenshot)
            print("\n📸 截图已保存 → douyin_screenshot.png")

        if md:
            out = "/Users/a1412/Desktop/Joker/douyin_result.md"
            with open(out, "w", encoding="utf-8") as f:
                f.write(md)
            print(f"\n💾 完整 Markdown 已保存 → {out}")

        if not result.success:
            print(f"\n❌ 错误: {result.error_message}")

asyncio.run(main())
