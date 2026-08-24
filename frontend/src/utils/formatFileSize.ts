export function formatFileSize(bytes: number, decimals: number = 2): string {
	if (bytes === 0) return "0 Bytes";

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function parseFileSize(sizeString: string): number {
	const units = {
		B: 1,
		KB: 1024,
		MB: 1024 * 1024,
		GB: 1024 * 1024 * 1024,
		TB: 1024 * 1024 * 1024 * 1024,
	};

	const match = sizeString.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i);

	if (!match) return 0;

	const value = parseFloat(match[1]);
	const unit = (match[2] || "B").toUpperCase();

	return value * (units[unit] || 1);
}

export function getMaxUploadSize(): number {
	return parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024; // 50MB default
}

export function isValidFileSize(size: number): boolean {
	return size <= getMaxUploadSize();
}
