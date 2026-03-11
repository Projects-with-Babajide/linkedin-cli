export function checkNotRoot(): void {
  if (process.platform !== 'win32' && process.getuid?.() === 0) {
    process.stderr.write(
      JSON.stringify({ success: false, error: { code: 'CONFIG_ERROR', message: 'Refusing to run as root' } }) + '\n'
    );
    process.exit(1);
  }
}
