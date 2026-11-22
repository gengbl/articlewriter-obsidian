declare module "*.md" {
	const value: string;
	export default value;
}

// docs/wechat_qr.png 以 dataurl loader 内联（esbuild.config.mjs）＝imported string＝"data:image/png;base64,…"
declare module "*.png" {
	const value: string;
	export default value;
}
