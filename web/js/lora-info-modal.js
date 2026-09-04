import { getLoraManagerIconImg, getExternalLinkMeta, modelInfoCache, modelThumbStatusCache, PLACEHOLDER_IMG_URL, ERROR_404_IMG_URL } from "./lora-manager-provider.js";
import { isComfyThemeLight } from "./settings.js";

class LoraInfoModalManager {
    constructor() {
        this.container = null;
        this.dialog = null;
        this.isOpen = false;
        this.isMetaOverlayOpen = false;
        this.currentData = null;
        this.activeImgIdx = 0;
        this.boundKeyHandler = this.handleKeyDown.bind(this);
    }

    ensureContainer() {
        if (this.container && document.body.contains(this.container)) return;

        this.container = document.createElement("div");
        this.container.id = "tagcomplete-lora-modal";
        this.container.className = "acModalBackdrop";
        this.container.style.display = "none";

        this.dialog = document.createElement("div");
        this.dialog.className = "acModalDialog";

        this.container.appendChild(this.dialog);
        document.body.appendChild(this.container);

        // Click on backdrop (outside dialog) closes modal
        this.container.addEventListener("mousedown", (e) => {
            if (e.target === this.container) {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            }
        });

        this.dialog.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        });
        this.dialog.addEventListener("click", (e) => {
            e.stopPropagation();
        });
        this.dialog.addEventListener("wheel", (e) => {
            e.stopPropagation();
        }, { passive: true });
    }

    handleKeyDown(e) {
        if (!this.isOpen) return;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (this.isMetaOverlayOpen) {
                this.hideMetaOverlay();
            } else {
                this.close();
            }
            return;
        }

        if (e.key === "ArrowLeft") {
            e.preventDefault();
            this.prevImage();
            return;
        }

        if (e.key === "ArrowRight") {
            e.preventDefault();
            this.nextImage();
            return;
        }
    }

    formatFileSize(bytes) {
        if (!bytes || typeof bytes !== "number") return "";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    async open(source) {
        this.ensureContainer();
        if (isComfyThemeLight()) {
            this.container?.setAttribute("data-theme", "light");
        } else {
            this.container?.removeAttribute("data-theme");
        }
        this.isOpen = true;
        this.activeImgIdx = 0;
        this.isMetaOverlayOpen = false;
        document.addEventListener("keydown", this.boundKeyHandler);

        const loraPath = typeof source === "string" ? source : (source?.loraPath || source?.file_path || source?.cleanName || "");
        const cleanName = source?.cleanName || (loraPath ? loraPath.split("/").pop().replace(/\.[^/.]+$/, "") : "LoRA Details");
        const cached = modelInfoCache.get(loraPath) || modelInfoCache.get(cleanName) || {};

        const fullPath = source?.fullPath || cached.fullPath || source?.rawModel?.file_path || "";
        const displayName = source?.displayName || cached.modelName || cleanName;
        const fileName = source?.fileName || cached.fileName || (loraPath ? loraPath.split("/").pop() : "");
        const folder = source?.folder || cached.folder || (loraPath && loraPath.includes("/") ? loraPath.substring(0, loraPath.lastIndexOf("/")) : "");
        const baseModel = source?.baseModel || cached.baseModel || "";
        const fileSize = source?.fileSize || cached.fileSize || 0;
        const notes = source?.notes || cached.notes || "";
        const usageTips = source?.usageTips || cached.usageTips || "";
        const civitaiUrl = source?.civitaiUrl || cached.civitaiUrl || "";

        const triggerWords = (Array.isArray(source?.triggerWords) && source.triggerWords.length > 0)
            ? source.triggerWords
            : (Array.isArray(cached.triggerWords) ? cached.triggerWords : []);

        const rawAllBlocks = (Array.isArray(source?.allCompoundBlocks) && source.allCompoundBlocks.length > 0)
            ? source.allCompoundBlocks
            : ((Array.isArray(cached?.compoundBlocks) && cached.compoundBlocks.length > 0)
                ? cached.compoundBlocks
                : (Array.isArray(source?.compoundBlocks) ? source.compoundBlocks : []));

        const compoundBlocks = rawAllBlocks.map(b => typeof b === "string" ? b : (b?.rawText || b));

        const cacheKey = `lora:${loraPath || cleanName}`;
        const cachedThumb = modelThumbStatusCache.get(cacheKey);

        let previewUrl = source?.previewUrl || cached?.previewUrl || "";
        if (!previewUrl) {
            if (cachedThumb && cachedThumb !== "none") {
                previewUrl = cachedThumb;
            } else {
                previewUrl = PLACEHOLDER_IMG_URL;
            }
        }

        const _rawSha = source?.sha256 || cached?.sha256 || source?.rawModel?.sha256 || cached?.rawModel?.sha256 || "";
        const sha256 = Array.isArray(_rawSha) ? _rawSha.map(h => String(h).toLowerCase()) : String(_rawSha || "").toLowerCase();

        this.currentData = {
            loraPath,
            cleanName,
            fullPath,
            displayName,
            fileName,
            folder,
            baseModel,
            fileSize: this.formatFileSize(fileSize),
            notes,
            usageTips,
            sha256,
            triggerWords,
            compoundBlocks,
            civitaiUrl,
            versionName: "",
            description: "",
            previewUrl,
            images: [{ url: previewUrl, isLocal: true, meta: null }]
        };

        this.renderContent();
        this.container.classList.add("active");
        this.container.style.display = "flex";

        if (!cachedThumb && !source?.previewUrl && (loraPath || cleanName)) {
            const probeUrl = `/autocomplete-plus-plus/models/thumbnail?type=loras&name=${encodeURIComponent(loraPath || cleanName)}&info=1`;
            (async () => {
                try {
                    const res = await fetch(probeUrl).catch(() => null);
                    if (res && res.ok) {
                        const data = await res.json().catch(() => null);
                        if (data?.has_thumbnail && data.url) {
                            modelThumbStatusCache.set(cacheKey, data.url);
                            if (this.currentData && (this.currentData.loraPath === loraPath || this.currentData.cleanName === cleanName)) {
                                this.currentData.previewUrl = data.url;
                                if (this.currentData.images && this.currentData.images[0]) {
                                    this.currentData.images[0].url = data.url;
                                }
                                if (this.isOpen) {
                                    this.updateGalleryUI();
                                    const mainImg = this.dialog?.querySelector("#acMainPreviewImg");
                                    if (mainImg && this.activeImgIdx === 0) {
                                        mainImg.src = data.url;
                                    }
                                }
                            }
                            return;
                        }
                    }
                } catch (_) {}
                modelThumbStatusCache.set(cacheKey, "none");
            })();
        }

        if (fullPath) {
            this.enrichMetadataAsync(fullPath, loraPath);
        }
    }

    async enrichMetadataAsync(fullPath, loraPath) {
        try {
            const metaUrl = `/api/lm/loras/metadata?file_path=${encodeURIComponent(fullPath)}`;
            const resp = await fetch(metaUrl, { cache: "no-store" });
            if (!resp.ok) return;

            const data = await resp.json();
            if (!data || !data.success || !data.metadata) return;

            const meta = data.metadata;
            let updated = false;

            if (meta.name && !this.currentData.versionName) {
                this.currentData.versionName = meta.name;
                updated = true;
            }
            if (meta.baseModel && !this.currentData.baseModel) {
                this.currentData.baseModel = meta.baseModel;
                updated = true;
            }
            if (meta.description && !this.currentData.description) {
                this.currentData.description = meta.description;
                updated = true;
            }
            if (!this.currentData.civitaiUrl && meta.modelId) {
                this.currentData.civitaiUrl = meta.id ? `https://civitai.com/models/${meta.modelId}?modelVersionId=${meta.id}` : `https://civitai.com/models/${meta.modelId}`;
                updated = true;
            }

            const galleryImages = this.extractImages(meta, loraPath, this.currentData.previewUrl);
            if (galleryImages.length > 0) {
                this.currentData.images = galleryImages;
                updated = true;
            }

            if (updated && this.isOpen) {
                this.updateBadgesUI();
                this.updateGalleryUI();
            }
        } catch (err) {
            console.debug("[Autocomplete++] Async metadata load note:", err);
        }
    }

    extractImages(meta, loraPath, localPreviewUrl) {
        const initialUrl = (localPreviewUrl && localPreviewUrl !== "none") ? localPreviewUrl : PLACEHOLDER_IMG_URL;
        const images = [
            {
                url: initialUrl,
                isLocal: true,
                meta: null
            }
        ];

        if (Array.isArray(meta?.images) && meta.images.length > 0) {
            meta.images.forEach(img => {
                if (img?.url) {
                    images.push({
                        url: img.url,
                        nsfwLevel: img.nsfwLevel,
                        width: img.width,
                        height: img.height,
                        meta: img.meta || null
                    });
                }
            });
        }
        if (Array.isArray(meta?.customImages) && meta.customImages.length > 0) {
            meta.customImages.forEach(img => {
                if (img?.url) {
                    images.push({
                        url: img.url,
                        nsfwLevel: img.nsfwLevel,
                        width: img.width,
                        height: img.height,
                        meta: img.meta || null
                    });
                }
            });
        }
        return images;
    }

    handleImageLoadError(failedImgObj) {
        if (!this.currentData || !Array.isArray(this.currentData.images)) return;
        if (!failedImgObj) return;

        // 1. Local Preview Image 404 Failure: Swap to 404.webp fallback (never remove index 0)
        if (failedImgObj.isLocal) {
            if (failedImgObj.url !== ERROR_404_IMG_URL) {
                failedImgObj.url = ERROR_404_IMG_URL;
                const activeImg = this.currentData.images[this.activeImgIdx];
                if (activeImg === failedImgObj) {
                    const mainImg = this.dialog?.querySelector("#acMainPreviewImg");
                    if (mainImg) mainImg.src = ERROR_404_IMG_URL;
                }
                const thumb = this.dialog?.querySelector(`.acThumbItem[data-idx="0"] img`);
                if (thumb) thumb.src = ERROR_404_IMG_URL;
            }
            return;
        }

        // 2. Remote Gallery Images: Safely prune from list (never use 404.webp for network images)
        const failedIdx = this.currentData.images.indexOf(failedImgObj);
        if (failedIdx === -1) return;

        const currentActiveImg = this.currentData.images[this.activeImgIdx];
        const wasActive = (failedImgObj === currentActiveImg);

        this.currentData.images = this.currentData.images.filter(img => img !== failedImgObj);

        if (this.currentData.images.length === 0) {
            this.currentData.images = [
                {
                    url: ERROR_404_IMG_URL,
                    isLocal: true,
                    meta: null
                }
            ];
            this.activeImgIdx = 0;
        } else {
            if (wasActive) {
                this.activeImgIdx = Math.max(0, Math.min(failedIdx, this.currentData.images.length - 1));
            } else {
                const newIdx = this.currentData.images.indexOf(currentActiveImg);
                this.activeImgIdx = newIdx !== -1 ? newIdx : 0;
            }
        }

        if (this.isOpen) {
            this.updateGalleryUI();
        }
    }

    prevImage() {
        if (!this.currentData || this.currentData.images.length <= 1) return;
        if (this.activeImgIdx > 0) {
            this.activeImgIdx--;
            this.updateMainPreview();
        }
    }

    nextImage() {
        if (!this.currentData || this.currentData.images.length <= 1) return;
        if (this.activeImgIdx < this.currentData.images.length - 1) {
            this.activeImgIdx++;
            this.updateMainPreview();
        }
    }

    updateMainPreview() {
        const d = this.currentData;
        if (!d || !d.images || d.images.length === 0) return;

        const currentImg = d.images[this.activeImgIdx] || d.images[0];
        const mainImg = this.dialog?.querySelector("#acMainPreviewImg");
        if (mainImg) {
            mainImg.src = currentImg.url;
            mainImg.onerror = () => {
                this.handleImageLoadError(currentImg);
            };
        }

        // Update thumbnails active state
        this.dialog?.querySelectorAll(".acThumbItem").forEach((t, i) => {
            t.classList.toggle("active", i === this.activeImgIdx);
        });

        // Scroll active thumbnail into view
        const activeThumb = this.dialog?.querySelector(`.acThumbItem[data-idx="${this.activeImgIdx}"]`);
        if (activeThumb) {
            activeThumb.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "nearest"
            });
        }

        // Update Prev / Next button states
        const prevBtn = this.dialog?.querySelector(".acGalleryPrev");
        const nextBtn = this.dialog?.querySelector(".acGalleryNext");
        if (prevBtn) prevBtn.classList.toggle("disabled", this.activeImgIdx <= 0);
        if (nextBtn) nextBtn.classList.toggle("disabled", this.activeImgIdx >= d.images.length - 1);

        // Update center hit area meta hint
        const centerHit = this.dialog?.querySelector(".acGalleryCenter");
        const hasMeta = !!(currentImg?.meta && (currentImg.meta.prompt || currentImg.meta.Model || currentImg.meta.seed));
        const isLocal = !!currentImg?.isLocal;
        if (centerHit) {
            centerHit.classList.toggle("has-meta", hasMeta);
            centerHit.title = hasMeta ? "Click to view image generation metadata" : "";
            if (hasMeta) {
                centerHit.innerHTML = `<div class="acMetaBadgeHint"><span>ℹ Generation Meta</span></div>`;
            } else if (isLocal) {
                centerHit.innerHTML = `<div class="acLocalPreviewBadge"><span>Local Preview</span></div>`;
            } else {
                centerHit.innerHTML = "";
            }
        }

        // If overlay is already open, dynamically switch metadata without closing; if new img has no meta, hide overlay
        if (this.isMetaOverlayOpen) {
            if (hasMeta) {
                this.renderMetaOverlayContent();
            } else {
                this.hideMetaOverlay();
            }
        }
    }

    updateGalleryUI() {
        const d = this.currentData;
        if (!d || !this.dialog) return;

        const showcaseCol = this.dialog.querySelector(".acShowcaseCol");
        if (!showcaseCol) return;

        const activeImg = d.images[this.activeImgIdx] || d.images[0];
        const hasMeta = !!(activeImg?.meta && (activeImg.meta.prompt || activeImg.meta.Model || activeImg.meta.seed));
        const isLocal = !!activeImg?.isLocal;
        const hasPrev = this.activeImgIdx > 0;
        const hasNext = this.activeImgIdx < d.images.length - 1;

        let badgeHtml = "";
        if (hasMeta) {
            badgeHtml = '<div class="acMetaBadgeHint"><span>ℹ Generation Meta</span></div>';
        } else if (isLocal) {
            badgeHtml = '<div class="acLocalPreviewBadge"><span>Local Preview</span></div>';
        }

        let thumbsHtml = "";
        if (d.images.length > 1) {
            const thumbs = d.images.map((img, idx) => `
                <div class="acThumbItem ${idx === this.activeImgIdx ? "active" : ""}" data-idx="${idx}">
                    <img src="${this.escapeAttr(img.url)}" alt="thumb" loading="lazy" />
                </div>
            `).join("");
            thumbsHtml = `<div class="acThumbsStrip">${thumbs}</div>`;
        }

        showcaseCol.innerHTML = `
            <div class="acMainPreviewWrap">
                <img id="acMainPreviewImg" src="${this.escapeAttr(activeImg.url)}" alt="Preview" />
                
                <!-- Left Prev Hit Area (22% width) -->
                <div class="acGalleryHit acGalleryPrev ${hasPrev ? "" : "disabled"}" title="Previous Image (←)">
                    <span class="acGalleryArrow">&lsaquo;</span>
                </div>
                
                <!-- Center Hit Area (56% width, click for meta) -->
                <div class="acGalleryHit acGalleryCenter ${hasMeta ? "has-meta" : ""}" title="${hasMeta ? "Click to view image generation metadata" : ""}">
                    ${badgeHtml}
                </div>
                
                <!-- Right Next Hit Area (22% width) -->
                <div class="acGalleryHit acGalleryNext ${hasNext ? "" : "disabled"}" title="Next Image (→)">
                    <span class="acGalleryArrow">&rsaquo;</span>
                </div>

                <!-- Generation Metadata Overlay -->
                <div id="acImgMetaOverlay" class="acImgMetaOverlay" style="display: none;"></div>
            </div>
            ${thumbsHtml}
        `;

        this.bindGalleryEvents();
    }

    updateBadgesUI() {
        const d = this.currentData;
        const badgesWrap = this.dialog?.querySelector("#acModalBadges");
        if (!badgesWrap || !d) return;

        const badges = [];
        if (d.baseModel) badges.push(`<span class="acBadge acBadgeBase">${this.escapeHTML(d.baseModel)}</span>`);
        if (d.versionName) badges.push(`<span class="acBadge acBadgeVer">${this.escapeHTML(d.versionName)}</span>`);
        if (d.fileSize) badges.push(`<span class="acBadge acBadgeSize">${this.escapeHTML(d.fileSize)}</span>`);

        const extMeta = getExternalLinkMeta(d.civitaiUrl);
        if (extMeta) {
            badges.push(`
                <a class="acBadge acBadgeExt acBadgeExt-${extMeta.type}" href="${this.escapeAttr(extMeta.url)}" target="_blank" title="${this.escapeAttr(extMeta.tooltip)}">
                    ${extMeta.iconImg}
                    <span>${this.escapeHTML(extMeta.name)}</span>
                </a>
            `);
        }

        badgesWrap.innerHTML = badges.join("");
    }

    renderMetaOverlayContent() {
        const d = this.currentData;
        if (!d) return;
        const currentImg = d.images[this.activeImgIdx];
        const meta = currentImg?.meta;
        if (!meta) return;

        const overlay = this.dialog.querySelector("#acImgMetaOverlay");
        if (!overlay) return;

        let promptHtml = "";
        if (meta.prompt) {
            promptHtml = `
                <div class="acMetaBlock">
                    <div class="acMetaKeyHeader">
                        <span class="acMetaKeyTitle">Prompt</span>
                        <button class="acMetaCopyBtn" data-copy="${this.escapeAttr(meta.prompt)}" title="Copy Prompt">Copy</button>
                    </div>
                    <div class="acMetaTextBox">${this.escapeHTML(meta.prompt)}</div>
                </div>
            `;
        }

        let negPromptHtml = "";
        if (meta.negativePrompt) {
            negPromptHtml = `
                <div class="acMetaBlock">
                    <div class="acMetaKeyHeader">
                        <span class="acMetaKeyTitle">Negative Prompt</span>
                        <button class="acMetaCopyBtn" data-copy="${this.escapeAttr(meta.negativePrompt)}" title="Copy Negative Prompt">Copy</button>
                    </div>
                    <div class="acMetaTextBox">${this.escapeHTML(meta.negativePrompt)}</div>
                </div>
            `;
        }

        // Key parameters list
        const params = [];
        if (meta.Model) params.push({ k: "Model", v: meta.Model });
        if (meta.sampler) params.push({ k: "Sampler", v: meta.sampler });
        if (meta.seed !== undefined) params.push({ k: "Seed", v: meta.seed });
        if (meta.steps !== undefined) params.push({ k: "Steps", v: meta.steps });
        if (meta.cfgScale !== undefined) params.push({ k: "CFG Scale", v: meta.cfgScale });
        if (meta.clipSkip !== undefined) params.push({ k: "Clip Skip", v: meta.clipSkip });
        if (meta.Size) params.push({ k: "Size", v: meta.Size });
        if (meta.VAE) params.push({ k: "VAE", v: meta.VAE });
        if (meta["Schedule type"]) params.push({ k: "Schedule", v: meta["Schedule type"] });
        if (meta["Hires upscaler"]) params.push({ k: "Hires Upscaler", v: meta["Hires upscaler"] });
        if (meta["Denoising strength"]) params.push({ k: "Denoise", v: meta["Denoising strength"] });

        let paramsGridHtml = "";
        if (params.length > 0) {
            const items = params.map(p => `
                <div class="acMetaParamItem">
                    <span class="acMetaParamKey">${this.escapeHTML(p.k)}:</span>
                    <span class="acMetaParamVal">${this.escapeHTML(String(p.v))}</span>
                </div>
            `).join("");
            paramsGridHtml = `
                <div class="acMetaBlock">
                    <div class="acMetaKeyTitle">Parameters</div>
                    <div class="acMetaParamsGrid">${items}</div>
                </div>
            `;
        }

        overlay.innerHTML = `
            <div class="acImgMetaHeader">
                <div class="acImgMetaTitleWrap">
                    <span class="acImgMetaTitle">Generation Metadata</span>
                </div>
                <button class="acImgMetaCloseBtn" title="Close Metadata (Esc)">&times;</button>
            </div>
            <div class="acImgMetaBody">
                ${promptHtml}
                ${negPromptHtml}
                ${paramsGridHtml}
            </div>
        `;

        const closeBtn = overlay.querySelector(".acImgMetaCloseBtn");
        if (closeBtn) {
            closeBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.hideMetaOverlay();
            });
            closeBtn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.hideMetaOverlay();
            });
        }

        overlay.querySelectorAll(".acMetaCopyBtn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const text = btn.getAttribute("data-copy");
                if (text) {
                    navigator.clipboard.writeText(text).then(() => {
                        const orig = btn.textContent;
                        btn.textContent = "Copied!";
                        setTimeout(() => { btn.textContent = orig; }, 1500);
                    });
                }
            });
        });
    }

    showMetaOverlay() {
        this.renderMetaOverlayContent();
        const overlay = this.dialog?.querySelector("#acImgMetaOverlay");
        if (overlay) {
            overlay.classList.add("active");
            overlay.style.display = "flex";
        }
        this.isMetaOverlayOpen = true;
    }

    hideMetaOverlay() {
        const overlay = this.dialog?.querySelector("#acImgMetaOverlay");
        if (overlay) {
            overlay.classList.remove("active");
            overlay.style.display = "none";
        }
        this.isMetaOverlayOpen = false;
    }

    bindGalleryEvents() {
        const prevBtn = this.dialog?.querySelector(".acGalleryPrev");
        if (prevBtn) {
            prevBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.prevImage();
            });
        }

        const nextBtn = this.dialog?.querySelector(".acGalleryNext");
        if (nextBtn) {
            nextBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.nextImage();
            });
        }

        const centerHit = this.dialog?.querySelector(".acGalleryCenter");
        if (centerHit) {
            centerHit.addEventListener("click", (e) => {
                e.stopPropagation();
                const currentImg = this.currentData?.images[this.activeImgIdx];
                if (currentImg?.meta) {
                    this.showMetaOverlay();
                }
            });
        }

        const mainImg = this.dialog?.querySelector("#acMainPreviewImg");
        if (mainImg) {
            mainImg.onerror = () => {
                const currentImg = this.currentData?.images[this.activeImgIdx];
                if (currentImg) {
                    this.handleImageLoadError(currentImg);
                }
            };
        }

        const thumbsStrip = this.dialog?.querySelector(".acThumbsStrip");
        if (thumbsStrip) {
            let isDown = false;
            let startX = 0;
            let scrollLeft = 0;
            let hasMoved = false;

            thumbsStrip.addEventListener("mousedown", (e) => {
                isDown = true;
                hasMoved = false;
                startX = e.pageX - thumbsStrip.offsetLeft;
                scrollLeft = thumbsStrip.scrollLeft;
                thumbsStrip.style.cursor = "grabbing";
            });

            const handleMouseUpOrLeave = () => {
                if (isDown) {
                    isDown = false;
                    thumbsStrip.style.cursor = "grab";
                }
            };

            thumbsStrip.addEventListener("mouseleave", handleMouseUpOrLeave);
            window.addEventListener("mouseup", handleMouseUpOrLeave);

            thumbsStrip.addEventListener("mousemove", (e) => {
                if (!isDown) return;
                e.preventDefault();
                const x = e.pageX - thumbsStrip.offsetLeft;
                const walk = (x - startX);
                if (Math.abs(walk) > 4) {
                    hasMoved = true;
                }
                thumbsStrip.scrollLeft = scrollLeft - walk;
            });

            thumbsStrip.addEventListener("wheel", (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    thumbsStrip.scrollLeft += e.deltaY;
                }
            }, { passive: false });

            thumbsStrip.querySelectorAll(".acThumbItem").forEach(thumb => {
                const idx = parseInt(thumb.getAttribute("data-idx"), 10);
                const imgObj = this.currentData?.images[idx];

                const thumbImg = thumb.querySelector("img");
                if (thumbImg && imgObj) {
                    thumbImg.onerror = (e) => {
                        e.stopPropagation();
                        this.handleImageLoadError(imgObj);
                    };
                }

                thumb.addEventListener("click", (e) => {
                    if (hasMoved) {
                        e.stopPropagation();
                        e.preventDefault();
                        hasMoved = false;
                        return;
                    }
                    e.stopPropagation();
                    if (imgObj && this.currentData?.images.includes(imgObj)) {
                        const currentIdx = this.currentData.images.indexOf(imgObj);
                        if (currentIdx !== -1) {
                            this.activeImgIdx = currentIdx;
                            this.updateMainPreview();
                        }
                    }
                });
            });
        }
    }

    renderContent() {
        const d = this.currentData;
        if (!d) return;

        // 1. Badges
        const badges = [];
        if (d.baseModel) badges.push(`<span class="acBadge acBadgeBase">${this.escapeHTML(d.baseModel)}</span>`);
        if (d.versionName) badges.push(`<span class="acBadge acBadgeVer">${this.escapeHTML(d.versionName)}</span>`);
        if (d.fileSize) badges.push(`<span class="acBadge acBadgeSize">${this.escapeHTML(d.fileSize)}</span>`);

        const extMeta = getExternalLinkMeta(d.civitaiUrl);
        if (extMeta) {
            badges.push(`
                <a class="acBadge acBadgeExt acBadgeExt-${extMeta.type}" href="${this.escapeAttr(extMeta.url)}" target="_blank" title="${this.escapeAttr(extMeta.tooltip)}">
                    ${extMeta.iconImg}
                    <span>${this.escapeHTML(extMeta.name)}</span>
                </a>
            `);
        }

        // 2. Usage Tips
        let usageTipsHtml = "";
        if (d.usageTips) {
            try {
                const tips = typeof d.usageTips === "string" ? JSON.parse(d.usageTips) : d.usageTips;
                const items = [];
                if (tips && typeof tips === "object") {
                    if (tips.strength !== undefined) items.push(`<span class="acTipChip">Strength: <b>${tips.strength}</b></span>`);
                    if (tips.strength_min !== undefined && tips.strength_max !== undefined) {
                        items.push(`<span class="acTipChip">Range: <b>${tips.strength_min} ~ ${tips.strength_max}</b></span>`);
                    }
                    if (tips.clip_strength !== undefined) items.push(`<span class="acTipChip">Clip: <b>${tips.clip_strength}</b></span>`);
                    if (tips.clip_skip !== undefined) items.push(`<span class="acTipChip">Clip Skip: <b>${tips.clip_skip}</b></span>`);
                }
                if (items.length > 0) {
                    usageTipsHtml = `
                        <div class="acModalSection">
                            <div class="acModalSectionLabel">Usage Parameters</div>
                            <div class="acTipChipsWrap">${items.join("")}</div>
                        </div>
                    `;
                }
            } catch (_) {}
        }

        // 3. Compound Blocks (Long Prompt Presets / Costumes)
        let compoundHtml = "";
        if (Array.isArray(d.compoundBlocks) && d.compoundBlocks.length > 0) {
            const blockCards = d.compoundBlocks.map((block, bIdx) => {
                const raw = typeof block === "string" ? block : block.rawText;
                return `
                    <div class="acModalPresetCard">
                        <div class="acModalPresetHeader">
                            <span class="acModalPresetTitle">Preset Prompt #${bIdx + 1}</span>
                            <button class="acModalPresetCopyBtn" data-copy="${this.escapeAttr(raw)}" title="Copy preset prompt">Copy</button>
                        </div>
                        <div class="acModalPresetText">${this.escapeHTML(raw)}</div>
                    </div>
                `;
            }).join("");

            compoundHtml = `
                <div class="acModalSection">
                    <div class="acModalSectionHeader">
                        <div class="acModalSectionLabel">Prompt Presets (${d.compoundBlocks.length})</div>
                    </div>
                    <div class="acModalPresetList">${blockCards}</div>
                </div>
            `;
        }

        // 4. Trained Words Chips
        let triggerWordsHtml = "";
        if (Array.isArray(d.triggerWords) && d.triggerWords.length > 0) {
            const tags = d.triggerWords.map(w => `<button class="acTriggerChip" data-tag="${this.escapeAttr(w)}" title="Click to copy">${this.escapeHTML(w)}</button>`).join("");
            triggerWordsHtml = `
                <div class="acModalSection">
                    <div class="acModalSectionHeader">
                        <div class="acModalSectionLabel">Trigger Words (${d.triggerWords.length})</div>
                        <button class="acCopyAllTriggersBtn" title="Copy all trigger words">Copy All</button>
                    </div>
                    <div class="acTriggerChipsWrap">${tags}</div>
                </div>
            `;
        }

        // 5. User Notes
        let notesHtml = "";
        if (d.notes && d.notes.trim() && d.notes.trim() !== "Add your notes here...") {
            notesHtml = `
                <div class="acModalSection">
                    <div class="acModalSectionLabel">User Notes</div>
                    <div class="acNotesBox">${this.escapeHTML(d.notes)}</div>
                </div>
            `;
        }

        // 6. Description
        let descHtml = "";
        if (d.description && d.description.trim()) {
            descHtml = `
                <div class="acModalSection">
                    <div class="acModalSectionLabel">Description</div>
                    <div class="acNotesBox">${this.escapeHTML(d.description)}</div>
                </div>
            `;
        }

        // 7. Image gallery (right column)
        const activeImg = d.images[this.activeImgIdx] || d.images[0];
        const hasMeta = !!(activeImg?.meta && (activeImg.meta.prompt || activeImg.meta.Model || activeImg.meta.seed));
        const isLocal = !!activeImg?.isLocal;
        const hasPrev = this.activeImgIdx > 0;
        const hasNext = this.activeImgIdx < d.images.length - 1;

        let centerBadgeHtml = "";
        if (hasMeta) {
            centerBadgeHtml = '<div class="acMetaBadgeHint"><span>ℹ Generation Meta</span></div>';
        } else if (isLocal) {
            centerBadgeHtml = '<div class="acLocalPreviewBadge"><span>Local Preview</span></div>';
        }

        let thumbsHtml = "";
        if (d.images.length > 1) {
            const thumbs = d.images.map((img, idx) => `
                <div class="acThumbItem ${idx === this.activeImgIdx ? "active" : ""}" data-idx="${idx}">
                    <img src="${this.escapeAttr(img.url)}" alt="thumb" loading="lazy" />
                </div>
            `).join("");
            thumbsHtml = `<div class="acThumbsStrip">${thumbs}</div>`;
        }

        // Relative path for display
        const displayPath = d.folder ? `${d.folder}/${d.fileName}` : (d.fileName || d.cleanName);

        const hashes = (Array.isArray(d.sha256) ? d.sha256 : (d.sha256 ? [d.sha256] : []));
        const openUrl = hashes.length ? `/autocomplete-plus-plus/open-in-lm?hashes=${encodeURIComponent(hashes.join(","))}` : "/loras";

        this.dialog.innerHTML = `
            <div class="acModalHeader">
                <div class="acModalTitleWrap">
                    <span class="acModalIcon">${getLoraManagerIconImg()}</span>
                    <div class="acModalTitleGroup">
                        <h3 class="acModalTitle">${this.escapeHTML(d.displayName)}</h3>
                        <div id="acModalBadges" class="acModalBadges">
                            ${badges.join("")}
                        </div>
                    </div>
                </div>
                <div class="acModalHeaderActions">
                    <button class="acModalCloseBtn" title="Close (Esc)">&times;</button>
                </div>
            </div>

            <div class="acModalBody">
                <div class="acModalGrid">
                    <div class="acInfoCol">
                        <div class="acModalSection">
                            <div class="acModalSectionLabel">File Path</div>
                            <div class="acFilePathWrap">
                                <span class="acFilePathText" title="${this.escapeAttr(d.fullPath || displayPath)}">${this.escapeHTML(displayPath)}</span>
                                <button class="acCopyPathBtn" title="Copy file path">Copy</button>
                            </div>
                        </div>

                        ${usageTipsHtml}
                        ${compoundHtml}
                        ${triggerWordsHtml}
                        ${notesHtml}
                        ${descHtml}
                    </div>

                    <div class="acShowcaseCol">
                        <div class="acMainPreviewWrap">
                            <img id="acMainPreviewImg" src="${this.escapeAttr(activeImg.url)}" alt="Preview" />
                            
                            <!-- Left Prev Hit Area (22% width) -->
                            <div class="acGalleryHit acGalleryPrev ${hasPrev ? "" : "disabled"}" title="Previous Image (←)">
                                <span class="acGalleryArrow">&lsaquo;</span>
                            </div>
                            
                            <!-- Center Hit Area (56% width, click for meta) -->
                            <div class="acGalleryHit acGalleryCenter ${hasMeta ? "has-meta" : ""}" title="${hasMeta ? "Click to view image generation metadata" : ""}">
                                ${centerBadgeHtml}
                            </div>
                            
                            <!-- Right Next Hit Area (22% width) -->
                            <div class="acGalleryHit acGalleryNext ${hasNext ? "" : "disabled"}" title="Next Image (→)">
                                <span class="acGalleryArrow">&rsaquo;</span>
                            </div>

                            <!-- Generation Metadata Overlay -->
                            <div id="acImgMetaOverlay" class="acImgMetaOverlay" style="display: none;"></div>
                        </div>
                        ${thumbsHtml}
                    </div>
                </div>
            </div>

            <div class="acModalFooter">
                <div class="acModalFooterLeft">
                    <a class="acFooterLink" href="${openUrl}" target="_blank" title="Open in LoRA Manager">Open in LoRA Manager ↗</a>
                </div>
                <div class="acModalFooterRight">
                    <button class="acFooterCloseBtn">Close</button>
                </div>
            </div>
        `;

        // Bind interactive events
        const closeBtn = this.dialog.querySelector(".acModalCloseBtn");
        if (closeBtn) {
            closeBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            });
            closeBtn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            });
        }

        const footerCloseBtn = this.dialog.querySelector(".acFooterCloseBtn");
        if (footerCloseBtn) {
            footerCloseBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            });
            footerCloseBtn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            });
        }

        const copyPathBtn = this.dialog.querySelector(".acCopyPathBtn");
        if (copyPathBtn) {
            copyPathBtn.addEventListener("click", () => {
                const pathToCopy = d.fullPath || displayPath;
                navigator.clipboard.writeText(pathToCopy).then(() => {
                    copyPathBtn.textContent = "Copied!";
                    setTimeout(() => { copyPathBtn.textContent = "Copy"; }, 1500);
                });
            });
        }

        const copyAllBtn = this.dialog.querySelector(".acCopyAllTriggersBtn");
        if (copyAllBtn && Array.isArray(d.triggerWords)) {
            copyAllBtn.addEventListener("click", () => {
                const text = d.triggerWords.join(", ");
                navigator.clipboard.writeText(text).then(() => {
                    copyAllBtn.textContent = "Copied!";
                    setTimeout(() => { copyAllBtn.textContent = "Copy All"; }, 1500);
                });
            });
        }

        // Chip click to copy individual tag (turns green temporarily without replacing text)
        this.dialog.querySelectorAll(".acTriggerChip").forEach(chip => {
            chip.addEventListener("click", () => {
                const tag = chip.getAttribute("data-tag");
                if (tag) {
                    navigator.clipboard.writeText(tag).then(() => {
                        chip.classList.add("copied");
                        setTimeout(() => {
                            chip.classList.remove("copied");
                        }, 1000);
                    });
                }
            });
        });

        // Modal preset card copy buttons
        this.dialog.querySelectorAll(".acModalPresetCopyBtn").forEach(btn => {
            btn.addEventListener("click", () => {
                const text = btn.getAttribute("data-copy");
                if (text) {
                    navigator.clipboard.writeText(text).then(() => {
                        btn.textContent = "Copied!";
                        setTimeout(() => { btn.textContent = "Copy"; }, 1500);
                    });
                }
            });
        });

        this.bindGalleryEvents();
    }

    close() {
        if (!this.isOpen && (!this.container || !this.container.classList.contains("active"))) return;
        this.isOpen = false;
        this.isMetaOverlayOpen = false;
        document.removeEventListener("keydown", this.boundKeyHandler);
        if (this.container) {
            this.container.classList.remove("active");
            this.container.style.display = "none";
        }
    }

    escapeHTML(str) {
        if (!str) return "";
        return String(str).replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag));
    }

    escapeAttr(str) {
        if (!str) return "";
        return String(str).replace(/"/g, '&quot;');
    }
}

export const loraInfoModal = new LoraInfoModalManager();
export function openLoraInfoModal(source) {
    return loraInfoModal.open(source);
}
