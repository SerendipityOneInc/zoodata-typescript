# @zoodata/sdk

> TypeScript SDK for [ZooData](https://zoodata.ai) — query Amazon, TikTok, and the open web from your code.

```ts
import { ZooData } from "@zoodata/sdk";

const client = new ZooData({ apiKey: process.env.ZOODATA_API_KEY });

const md = await client.scrape({ url: "https://example.com", format: "md" });
const products = await client.ecommerce.amazon.products.search({
  keyword: "wireless earbuds",
  priceMin: 20,
});
```

## Install

```bash
npm install @zoodata/sdk
```

## Companion CLI

For terminal use, see [`zoodata`](https://github.com/SerendipityOneInc/zoodata-cli).

## License

MIT
