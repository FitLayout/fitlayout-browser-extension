/**
 * FitLayout puppetteer backend.
 * (c) 2020-2026 Radek Burget <burgetr@fit.vutbr.cz>
 * 
 * lines.js
 * Text line detection in the target DOM.
 */

// Set to true in browser environment where the viewport is limited so that we have to scroll to detect lines.
var fitlayoutScrollEnabled = false;

/**
 * Scans current DOM document and makes the following changes in the body:
 * - All text nodes are wrapped in <XX> elements
 * - Text lines are detected in text nodes and wrapped in separate <XL> elements.  
 */
 function fitlayoutDetectLines() {

	var TEXT_CONT = "XX"; // element name to be used for wrapping the text nodes
	var LINE_CONT = "XL"; // element name to be used for wrapping the detected lines

	function markXPaths(root, rootXPath) {
		root.FLXPath = rootXPath;
		const children = root.childNodes;
		let elemCnt = 0;
		let textCnt = 0;
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			let xstep = '';
			if (child.nodeType === Node.ELEMENT_NODE) {
				elemCnt++;
				xstep = '*[' + elemCnt + ']';
			} else if (child.nodeType === Node.TEXT_NODE) {
				textCnt++;
				xstep = 'text()[' + textCnt + ']';
			}
			markXPaths(child, rootXPath + '/' + xstep);
		}
	}

	/**
	 * Returns the intersection of the bounding rects of all overflow:hidden/clip
	 * ancestors, or null if no clipping ancestor exists.
	 * All coordinates are viewport-relative (consistent with getClientRects).
	 */
	function getClipRect(element) {
		var clip = null;
		var ancestor = element.parentElement;
		while (ancestor && ancestor !== document.documentElement) {
			var style = window.getComputedStyle(ancestor);
			var clipInX = style.overflowX === 'hidden' || style.overflowX === 'clip';
			var clipInY = style.overflowY === 'hidden' || style.overflowY === 'clip';
			if (clipInX || clipInY) {
				var r = ancestor.getBoundingClientRect();
				if (clip === null) {
					clip = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
				} else {
					if (clipInX) {
						clip.left  = Math.max(clip.left,  r.left);
						clip.right = Math.min(clip.right, r.right);
					}
					if (clipInY) {
						clip.top    = Math.max(clip.top,    r.top);
						clip.bottom = Math.min(clip.bottom, r.bottom);
					}
				}
			}
			ancestor = ancestor.parentElement;
		}
		return clip;
	}

	function isRectVisible(rect, clip) {
		if (clip === null) return true;
		return rect.right  > clip.left  &&
		       rect.left   < clip.right &&
		       rect.bottom > clip.top   &&
		       rect.top    < clip.bottom;
	}

	function getCaretOffset(x, y) {
		if (document.caretPositionFromPoint) {
			// W3C standard (Firefox, Chrome 128+)
			const pos = document.caretPositionFromPoint(x, y);
			return pos ? pos.offset : null;
		} else if (document.caretRangeFromPoint) {
			// Non-standard fallback (Chrome/Safari)
			const range = document.caretRangeFromPoint(x, y);
			return range ? range.startOffset : null;
		}
		return null;
	}

	/**
	 * Like getCaretOffset but returns null if the caret position belongs to a
	 * different node than element's text node. This prevents using a garbage
	 * offset from an unrelated element when the target coordinates are outside
	 * an overflow:hidden boundary (the clipped content is not hit-testable there).
	 */
	function getCaretOffsetInElement(element, x, y) {
		const textNode = element.firstChild;
		if (document.caretPositionFromPoint) {
			const pos = document.caretPositionFromPoint(x, y);
			if (pos && pos.offsetNode === textNode)
				return pos.offset;
			return null;
		} else if (document.caretRangeFromPoint) {
			const range = document.caretRangeFromPoint(x, y);
			if (range && range.startContainer === textNode)
				return range.startOffset;
			return null;
		}
		return null;
	}

	/**
	 * Finds lines in a given XX element and marks them with separate elements.
	 * @param {Element} xx the XX element to be processed.
	 */
	function createLines(xx) {
		const clip = getClipRect(xx);
		const allRects = Array.from(xx.getClientRects());
		const firstClippedIdx = allRects.findIndex(r => !isRectVisible(r, clip));
		const rects = firstClippedIdx === -1 ? allRects : allRects.slice(0, firstClippedIdx);
		// Compute the text offset where the first clipped line begins so the last
		// visible XL element is truncated there rather than extending to text.length.
		// getCaretOffsetInElement returns null if the coordinates hit a different
		// element (overflow:hidden clips the content from hit-testing), in which
		// case splitTextByLines falls back to text.length.
		let endOffset = null;
		if (firstClippedIdx !== -1) {
			const fc = allRects[firstClippedIdx];
			endOffset = getCaretOffsetInElement(xx, fc.x + 1, fc.y + fc.height / 2);
		}
		if (rects.length > 1) {
			const parent = xx.parentElement;
			lines = splitTextByLines(xx, xx.textContent, rects, endOffset);
			xx.innerText = '';
			for (var line of lines) {
				parent.insertBefore(line, xx);
			}
			parent.removeChild(xx);
			return lines.length;
		} else {
			return rects.length;
		}
	}

	/**
	 * Splits the text content of a given element based on the client rectangles.
	 *
	 * @param {Element} parent the parent element of the text node
	 * @param {string} text the text content to be split
	 * @param {*} rects element client rectangles to be used for splitting
	 * @param {number|null} endOffset character offset to use as the end of the last
	 *        line; pass null to use the full text length (no clipping)
	 */
	function splitTextByLines(parent, text, rects, endOffset) {
		var breaks = [];
		var lastY = -Infinity;
		for (var i = 0; i < rects.length; i++) {
			var rect = rects[i];
			var ofs = getCaretOffset(rect.x + 1, rect.y + rect.height / 2);
			if (ofs !== null && rect.y !== lastY) {
				breaks.push(ofs);
				lastY = rect.y;
			}
		}
		// endOffset must be strictly greater than the last recorded break; otherwise
		// text.substring(lastBreak, endOffset) would produce empty or swapped content
		// (JS substring swaps args when end < start).
		const lastBreak = breaks.length > 0 ? breaks[breaks.length - 1] : 0;
		breaks.push(endOffset !== null && endOffset > lastBreak ? endOffset : text.length);
		//split to elements
		var lines = [];
		for (var i = 0; i < breaks.length - 1; i++) {
			var subtext = text.substring(breaks[i], breaks[i + 1]);
			var line = document.createElement(LINE_CONT);
			line.FLXPath = parent.FLXPath;
			line.appendChild(document.createTextNode(subtext));
			lines.push(line);
		}
		return lines;
	}

	function isVisibleElement(e) {
		if (e.nodeType == Node.ELEMENT_NODE) {
			return (e.getClientRects().length > 0);
		}
		return false;
	}

	/**
	 * Replaces text nodes with XX elements to avoid mixed content.
	 * @param {Element} p the root element of the subtree to process.
	 */
	function unmix(p) {
		const children = p.childNodes;
		const isMulti = (p.getClientRects().length > 1); //preserve whitespace nodes in multi-rect elements
		// create the elements for thext nodes
		let replace = [];
		for (var i = 0; i < children.length; i++) {
			var child = children.item(i);
			if (child.nodeType == Node.TEXT_NODE && (isMulti || child.nodeValue.trim().length > 0)) {
				var newchild = document.createElement(TEXT_CONT);
				newchild.FLXPath = p.FLXPath + '/node()[' + (i + 1) +']';
				newchild.appendChild(document.createTextNode(child.nodeValue));
				replace.push(newchild);
			} else {
				replace.push(null);
				if (isVisibleElement(child)) {
					unmix(child);
				}
			}
		}
		// replace the text nodes with elements in DOM
		for (var i = 0; i < replace.length; i++) {
			if (replace[i] != null) {
				p.replaceChild(replace[i], children.item(i));
			}
		}
		// remove the text elements that are rendered as empty
		if (isMulti) {
			for (var i = 0; i < replace.length; i++) {
				if (replace[i] != null && replace[i].innerText.length == 0) {
					p.removeChild(replace[i]);
				}
			}
		}
	}

	markXPaths(document.body, '//body[1]');
	unmix(document.body);
	var xxs = Array.from(document.getElementsByTagName(TEXT_CONT));

	if (fitlayoutScrollEnabled) {
		// Capture page-absolute Y for every element while scroll is at 0.
		// getBoundingClientRect().top == page-absolute Y when scrollY === 0,
		// which is guaranteed by the caller (contentScript.js scrolls to top first).
		var xxWithY = xxs.map(xx => ({ xx, pageY: xx.getBoundingClientRect().top }));
		xxWithY.sort((a, b) => a.pageY - b.pageY);

		var viewportHeight = window.innerHeight;
		var i = 0;
		while (i < xxWithY.length) {
			var bandStart = Math.max(0, Math.floor(xxWithY[i].pageY / viewportHeight) * viewportHeight);
			var bandEnd = bandStart + viewportHeight;
			window.scrollTo({ top: bandStart, behavior: 'instant' });
			while (i < xxWithY.length && xxWithY[i].pageY < bandEnd) {
				var n = createLines(xxWithY[i].xx);
				if (n === 0) {
					console.log(xxWithY[i].xx);
				}
				i++;
			}
		}
		window.scrollTo({ top: 0, behavior: 'instant' });
	} else {
		for (var i = 0; i < xxs.length; i++) {
			var n = createLines(xxs[i]);
			if (n === 0) {
				console.log(xxs[i]);
			}
		}
	}
}
