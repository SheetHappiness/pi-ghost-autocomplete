export interface ModelAsset {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}
const base =
  "https://huggingface.co/HuggingFaceTB/SmolLM2-135M/resolve/93efa2f097d58c2a74874c7e644dbc9b0cee75a2/";
export const MODEL_ID = "smollm2-135m-q8_0-d948db3614be-93efa2f097d5";
export const MODEL_ASSETS: readonly ModelAsset[] = [
  {
    name: "config.json",
    url: base + "config.json",
    bytes: 704,
    sha256: "1d556eab73b69c7f11f64c557a2f9c6f440bd4c6b89bb2584a6b498c92603843",
  },
  {
    name: "tokenizer.json",
    url: base + "tokenizer.json",
    bytes: 2104556,
    sha256: "9ca9acddb6525a194ec8ac7a87f24fbba7232a9a15ffa1af0c1224fcd888e47c",
  },
  {
    name: "SmolLM2-135M.Q8_0.gguf",
    url: "https://huggingface.co/QuantFactory/SmolLM2-135M-GGUF/resolve/d948db3614be18259a175aafd7689a70f1cb4e2f/SmolLM2-135M.Q8_0.gguf",
    bytes: 144810464,
    sha256: "b761d9ccdfce67726e41ca2ef30e9dfbcf6a32ca2aaef47df5c049ec362d04cd",
  },
];
