// The Features pages' Markdown (content/features/), bundled as text (each import says `with: { loader: 'text' }`).
declare module '*.md' {
  const text: string;
  export default text;
}
