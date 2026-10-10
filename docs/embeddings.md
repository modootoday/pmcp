# Embedding models

[Back to the overview](../README.md)

## Switching embedding models

List the built-in presets with `pmcp models` (or `pmcp models --json`). Select a
model once in your project's `pmcp.toml`; both indexing and the stdio server use
the same settings:

```toml
[embedding]
model = "embeddinggemma-2"
dimensions = 256
cache_dir = ".cache/pmcp/models"
```

```sh
pmcp index
pmcp serve
```

Indexing explicitly downloads missing model artifacts. Serving reads only local
artifacts and an existing, complete index. A missing model, stale catalog or
incompatible vectors keeps ranking lexical and reports the reason on stderr.
`pmcp index --dry-run` plans work without loading a model or writing files;
`pmcp index --local-only` refuses downloads. Use `[embedding] enabled = false`
or `pmcp serve --lexical` to disable semantic ranking.

| Preset                | Default precision | Supported output dimensions |
| --------------------- | ----------------- | --------------------------- |
| `e5-small`            | `q8`              | 384                         |
| `embeddinggemma-300m` | `q4`              | 768, 512, 256, 128          |
| `embeddinggemma-2`    | `q4`              | 768, 512, 256, 128          |

E5 remains the default. Gemma presets use qualified, pinned revisions, listed by
`pmcp models --json`; E5 retains its existing `main` revision for compatibility.
Gemma dimension reduction truncates and re-normalizes the projected embedding;
it reduces vector storage, not loaded model memory.

CLI flags override individual config fields: `--model`, `--dtype`,
`--dimensions`, `--model-revision`, `--model-path`, `--model-cache`,
`--query-prefix`, `--passage-prefix` and `--pooling`. Omit precision and dimensions
in the file when you want each model's defaults. Use `--no-config` for an
independent CLI selection. Config paths resolve relative to the TOML file;
CLI model paths resolve relative to the working directory.

Query caches also include the encoder identity, so sharing a cache between
same-width profiles cannot reuse another encoder's query vector. Library hosts
using openIntentCache must open a cache with the selected output width when
changing dimensions; pass the encoder's indexKey as its modelId for explicit
profile-scoped cache metadata.

Each model, revision, precision, output width and encoder specification has its
own vector identity. Switching preserves other models' indexes; switching back
reuses unchanged vectors. `--force` re-encodes only the selected model. A local
`model_path` must contain the declared revision's artifacts; change `revision`
and reindex after replacing them. The directory's location is not its identity.

Custom Transformers.js feature-extraction models need no source edits:

```toml
[embedding]
model = "your-organization/your-onnx-model"
dtype = "q8"
revision = "your-pinned-revision"

[embedding.encoder]
query_prefix = "query: "
passage_prefix = "passage: "
pooling = "mean"
```

Use the model's documented prefixes and pooling (`mean` or `cls`); unknown models
default to unprefixed mean pooling. A native `sentence_embedding` export may use
`projected = true`. Explicit dimension reduction is supported for the listed
presets. Other architectures require compatible Transformers.js exports.

The library API shares the same presets and identity rules:

```js
import { loadEmbedder, prepareSearch } from "@modootoday/pmcp";

const encoder = await loadEmbedder("embeddinggemma-2", {
  dimensions: 256,
  modelPath: "/opt/models/embeddinggemma-2",
  localOnly: true,
});
const search = await prepareSearch(
  { roots: ["node_modules"] },
  {
    indexPath: "node_modules/.cache/pmcp/vectors.sqlite",
    modelId: "embeddinggemma-2",
    dimensions: 256,
    embedder: encoder ?? undefined,
  },
);
```

HTTP hosts use these options under `semantic`; HTTP catalogs are encoded in
memory at startup rather than reading the CLI's persisted index. Model runtime
settings are passed to each loader without changing global download or cache
policy, so hosts can prepare different encoders in one process.

## Runtime and licence

Node.js 22 or later, or Bun 1.3 or later. Ranking is lexical until an index and
encoder are ready. Semantic
ranking (the `index` command, or the HTTP handler's `semantic` option) needs
`@huggingface/transformers` installed separately; it is not part of the default
installation. The default encoder is `Xenova/multilingual-e5-small` (MIT, about
130 MB), so vectors indexed with the earlier English-only default are re-encoded.

The optional encoder also supports the ONNX Community EmbeddingGemma 300M and
EmbeddingGemma 2 exports. It uses their projected sentence embeddings and task
prefixes. EmbeddingGemma 2 loads its text encoder without vision or audio models.
EmbeddingGemma was qualified with Transformers.js 4.3.1. Install a version
supporting the chosen export and keep model
weights outside the npm package. Regenerate document vectors when changing the
encoder. Quantization reduces weight storage; application RAM and latency need
workload measurements. EmbeddingGemma 300M uses the Gemma terms; EmbeddingGemma 2
is listed under Apache-2.0 in its model card.

Elastic License 2.0. See `LICENSE` and `NOTICE` for terms and dependency notices.
Documentation: <https://pmcp.build>.
