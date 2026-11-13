/**
 * Whether a chrome.runtime message comes from one of the extension's own
 * pages (the popup and the request windows).
 *
 * Content scripts can call chrome.runtime.sendMessage() too, and they run
 * inside arbitrary web pages. Their sender.url is the web page's URL, so
 * requiring the extension's own origin keeps web pages away from the
 * popup-only handlers (signing, sending, account management).
 */
export function isExtensionPage(
  sender: { id?: string; url?: string } | undefined,
  extensionId: string,
  extensionBaseUrl: string
): boolean {
  return (
    !!sender &&
    !!extensionId &&
    !!extensionBaseUrl &&
    sender.id === extensionId &&
    typeof sender.url === 'string' &&
    sender.url.indexOf(extensionBaseUrl) === 0
  );
}
