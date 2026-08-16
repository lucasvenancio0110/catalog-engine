export function getProductMedia(product = {}) {
  const media = Array.isArray(product.media) ? product.media : [];
  if (media.length) {
    return media
      .map((item) => ({
        url: item?.url,
        thumbnailUrl: item?.thumbnailUrl || item?.url,
        downloadUrl: item?.downloadUrl || item?.url,
        width: item?.width,
        height: item?.height,
        bytes: item?.bytes,
        format: item?.format
      }))
      .filter((item) => item.url);
  }

  return (Array.isArray(product.images) ? product.images : [])
    .map((image) => (typeof image === 'string' ? image : image?.url))
    .filter(Boolean)
    .map((url) => ({ url, thumbnailUrl: url, downloadUrl: url }));
}

export function productGalleryUrls(product) {
  return getProductMedia(product).map((media) => media.url);
}
