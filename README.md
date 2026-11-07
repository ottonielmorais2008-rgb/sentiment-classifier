# Sentiment classifier

A small English positive/negative classifier that runs in the browser. The page is static. After you choose **Load model**, [Transformers.js](https://huggingface.co/docs/transformers.js) downloads a quantized DistilBERT model and runs it on this device with WebAssembly. The text you type is not sent to a server.

**Live site:** [https://ottonielmorais2008-rgb.github.io/sentiment-classifier/](https://ottonielmorais2008-rgb.github.io/sentiment-classifier/)

## Architecture

The published site is a static Vite build. There is no application backend.

1. The page starts with the model unloaded. Nothing is downloaded until **Load model**.
2. **Load model** starts a Web Worker. Transformers.js runs there so the download and inference stay off the UI thread.
3. The worker creates one `sentiment-analysis` pipeline for `Xenova/distilbert-base-uncased-finetuned-sst-2-english` with `dtype: "q8"` and `device: "wasm"`.
4. Transformers.js fetches the model files from Hugging Face and stores them in the browser cache (`env.useBrowserCache`).
5. **Classify sentiment** sends the trimmed text to that worker. The worker returns a label and a score. The page drops late replies when the text was edited or cleared, and it does not run the model again for the same text.

```
page (validation, state, race ids)
  -> module worker
       -> Transformers.js + ONNX Runtime WebAssembly
            -> Hugging Face: quantized ONNX weights and tokenizer
```

GitHub Pages only hosts the HTML, CSS, and JavaScript. The weights are not in this repository.

## Privacy

- The text you type is used only in memory for the local inference call. It is not written to `localStorage`, the URL, application logs, or a request body.
- Loading the model requests weight and tokenizer files from Hugging Face (`huggingface.co` and its download hosts). Those requests do not include the text. The page sets `referrer` to `no-referrer`.
- The browser cache then holds the model files, not your passages. Clearing site data for the origin removes that cache.
- There is no account, telemetry, or third-party analytics script. The app does not load web fonts.
- The first visit needs network access for the library’s model host. After the files are cached, classification can run without downloading them again. The page itself still has to be loaded from wherever you host it.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:5173/sentiment-classifier/](http://127.0.0.1:5173/sentiment-classifier/). The base path matches GitHub Pages, so the local app is not served from `/`.

Other commands:

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

`npm run preview` serves the production build at [http://127.0.0.1:4173/sentiment-classifier/](http://127.0.0.1:4173/sentiment-classifier/).

`npm test` does not download the model. The tests use a fake worker client and pure functions. They cover validation, load and error states, label mapping, clear/reset, and stale in-flight results.

## Model

| Item | Value |
| --- | --- |
| Task | Binary sentiment (positive or negative) |
| Checkpoint | [distilbert/distilbert-base-uncased-finetuned-sst-2-english](https://huggingface.co/distilbert/distilbert-base-uncased-finetuned-sst-2-english) |
| Weights used here | [Xenova/distilbert-base-uncased-finetuned-sst-2-english](https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english) |
| File for `dtype: "q8"` | `onnx/model_quantized.onnx` |
| File size | 67,581,197 bytes (67.6 MB) |
| Labels | `NEGATIVE` (0), `POSITIVE` (1) |
| License of the source checkpoint | Apache-2.0 |

The ONNX repository is the Transformers.js conversion of the Hugging Face DistilBERT SST-2 checkpoint (DistilBERT by Sanh, Debut, Chaumond, and Wolf; SST-2 fine-tune published by Hugging Face). DistilBERT is a distilled BERT. SST-2 is the Stanford Sentiment Treebank binary task (Socher et al., 2013). Training used short review sentences (`max_seq_length` 128 on the model card).

Hub file sizes checked for this choice:

| File | Bytes |
| --- | --- |
| `onnx/model_quantized.onnx` (`q8`) | 67,581,197 |
| `onnx/model_int8.onnx` | 67,370,466 |
| `onnx/model_uint8.onnx` | 67,370,488 |
| `onnx/model_q4f16.onnx` | 73,044,407 |
| `onnx/model_q4.onnx` | 124,633,754 |
| `onnx/model_fp16.onnx` | 134,088,280 |
| `onnx/model.onnx` (`fp32`) | 267,955,711 |

`q8` is the Transformers.js WASM default and is the file reported as about 67.6 MB. In this repository the `q4` file is larger, so it is not the smaller download. `int8` is slightly smaller, but it is a different file from the one `dtype: "q8"` requests. `tokenizer.json` is 711,396 bytes. A browser load of this app requested `config.json`, `tokenizer_config.json`, `tokenizer.json`, and `onnx/model_quantized.onnx`. The ONNX response was 67,581,197 bytes. It did not request `vocab.txt`.

The upstream model card says this checkpoint reaches an accuracy of 91.3 on the SST-2 dev set. **This project did not measure accuracy, precision, recall, or calibration.** The percentage in the UI is only the model’s score for the label it chose.

## Limitations

- English only. The checkpoint is uncased English DistilBERT fine-tuned on SST-2.
- Two labels only. There is no neutral class, so mild or mixed text still gets positive or negative.
- Sarcasm, negation, and mixed sentiment are easy to get wrong.
- The model card documents bias: a sentence such as “This film was filmed in …” can swing positive or negative with the place name alone. Do not use the tool for decisions about people.
- It is a sentence-level movie-review model. It is not a general emotion, intent, or factuality system.
- Inputs longer than 500 characters are rejected. That stays under the 512-token position limit even in a worst case of one token per character plus the two special tokens. The model was trained with a maximum sequence length of 128, so longer passages inside the 500-character cap are still outside the training shape.
- The first run downloads tens of megabytes and then holds the model in memory. Low-memory phones may fail or stall. Inference is single-threaded WebAssembly on the CPU, because GitHub Pages does not send the cross-origin-isolation headers that threaded WASM needs.
- A high score is not certainty. The UI says this, and the app does not claim a measured accuracy of its own.

## Technical choices

- Vite and TypeScript, with no UI framework and no server.
- Transformers.js (`@huggingface/transformers`) in a module worker, lazy-loaded on the button.
- Quantized `q8` weights, as sized above, instead of fp32 or a larger `q4` file.
- The ONNX Runtime used with that build is the SIMD WebAssembly file `ort-wasm-simd-threaded.wasm` (11,133,407 bytes, about 11.1 MB), copied into the site at `ort/` and loaded from the same origin. Transformers.js would otherwise set its runtime path to jsDelivr; this app replaces that path. `numThreads` is 1 and the WASM proxy is off, because GitHub Pages does not send cross-origin isolation headers.
- The worker, runtime, and weights are created only after **Load model**. Opening the page does not start those downloads.
- System fonts only, so the page does not call a font host.
- Explicit **Load model**, progress, a failed-load retry, and a separate classify action.
- The same trimmed text is not classified twice. A newer edit or **Clear** invalidates an in-flight result.
- Unit tests mock the worker. They never fetch weights. A real browser run is a separate check and is not part of `npm test`.

## GitHub Pages

The Vite `base` is `/sentiment-classifier/`.

The workflow in `.github/workflows/ci.yml`:

- On pull requests, pushes, and manual runs: install, typecheck, test, and build. The job token can read repository contents and nothing else.
- On a push to `main`, or a manual run of the workflow from `main`: build again and deploy `dist` with the official Pages actions. Only that job has `pages: write`, `id-token: write`, and `actions: read`.
- Actions are pinned to commit SHAs of current releases: `actions/checkout` v7.0.1, `actions/setup-node` v7.0.0, `actions/upload-pages-artifact` v5.0.0, and `actions/deploy-pages` v5.0.1.

GitHub Pages publishes that build from the Actions workflow. The public site is the link at the top of this page.
