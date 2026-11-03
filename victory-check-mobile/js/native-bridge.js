/**
 * Нативная оболочка Capacitor (iPhone / Android) — камера и флаги платформы.
 */
(function () {
  function getCap() {
    return typeof window !== 'undefined' ? window.Capacitor : null;
  }

  function isNative() {
    var cap = getCap();
    return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  }

  function getCameraPlugin() {
    var cap = getCap();
    if (!cap || !cap.Plugins) return null;
    return cap.Plugins.Camera || null;
  }

  function initFlags() {
    if (!isNative()) return;
    var cap = getCap();
    var platform = cap.getPlatform ? cap.getPlatform() : '';
    window.VC_NATIVE = true;
    window.VC_NATIVE_IOS = platform === 'ios';
    if (platform === 'android') window.VC_ANDROID_APP = true;
  }

  function dataUrlFromPhoto(photo) {
    if (!photo) return null;
    if (photo.dataUrl) return photo.dataUrl;
    if (photo.base64String) {
      var fmt = photo.format === 'png' ? 'png' : 'jpeg';
      return 'data:image/' + fmt + ';base64,' + photo.base64String;
    }
    return null;
  }

  async function pickOnePhoto() {
    var Camera = getCameraPlugin();
    if (!Camera || !Camera.getPhoto) return null;
    try {
      var photo = await Camera.getPhoto({
        quality: 72,
        allowEditing: false,
        resultType: 'dataUrl',
        source: 'PROMPT',
        correctOrientation: true,
        saveToGallery: false,
      });
      return dataUrlFromPhoto(photo);
    } catch (err) {
      var msg = err && (err.message || String(err));
      if (msg && /cancel|user denied|dismiss/i.test(msg)) return null;
      if (typeof toast === 'function') toast(msg || 'Камера недоступна');
      return null;
    }
  }

  /** Добавить фото в мастере (+ на шаге 3) через нативную камеру/галерею */
  window.vcOpenWizardPhotoPicker = async function () {
    if (!isNative() || typeof wizard === 'undefined') return false;
    if (wizard.media.length >= 10) {
      if (typeof toast === 'function') toast('Максимум 10 фото');
      return true;
    }
    var dataUrl = await pickOnePhoto();
    if (!dataUrl) return true;
    wizard.media.push(dataUrl);
    if (wizard.media.length > 10) wizard.media = wizard.media.slice(0, 10);
    if (typeof renderWizard === 'function') renderWizard();
    if (typeof toast === 'function') toast('Фото: ' + wizard.media.length);
    return true;
  };

  window.vcIsNativeApp = isNative;

  initFlags();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFlags);
  }
})();
