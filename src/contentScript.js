window.globalJsonResponse = null;
window.globalURL = null;
browser.runtime.sendMessage({ action: "displaySpinner", html: window.globalJsonResponse });

browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === "updatePointerEvents") {
        const newPointerEvents = message.pointerEvents;

        let overlayDiv = document.getElementById('overlayDiv');
        if (overlayDiv) {
            overlayDiv.style.pointerEvents = newPointerEvents;
            console.log(`Pointer events updated to ${newPointerEvents}`);
        }
    }
});

browser.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "genJson") {

        async function evaluatePage() {

            const EVAL_TIMEOUT = 60; // in seconds
            fitlayoutDetectLines();
            let pageTask = fitlayoutExportBoxes();

            let timerId = 0;
            let timerTask = new Promise((resolve, reject) => {
                timerId = setTimeout(resolve, EVAL_TIMEOUT * 1000, { error: 'Evaluation timeout' });
            });

            try {
                let pg = await Promise.race([pageTask, timerTask]);
                clearTimeout(timerId);

                // Screenshot - base64
                const screenshotPromise = new Promise((resolve, reject) => {
                    browser.runtime.sendMessage({ action: "captureTab" }).then(response => {
                        if (response.error) {
                            console.error('Error capturing screenshot:', response.error);
                            reject(response.error);
                        } else {
                            console.log('Screenshot captured successfully');
                            resolve(response.dataScreenshot);
                            console.log('Screenshot:', response.dataScreenshot);
                        }
                    });
                });

                pg.screenshot = await screenshotPromise;

                var jsonStringified = JSON.stringify(pg);
                console.log(jsonStringified);
                sendDataToServer(jsonStringified);

                return pg;
            } catch (error) {
                console.error("Error during page evaluation:", error);
            }
        }

        async function sendDataToServer(data) {
            try {
                if (!/^https?:\/\//.test(request.url)) {
                    request.url = 'https://' + request.url;
                }

                request.url = request.url.replace(/\/\.\./, '/' + request.uid);

                let response = await fetch(request.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: data
                });

                if (response.ok) {
                    console.log("Data sent successfully");
                    let jsonResponse = await response.text();
                    // Process server response
                    window.globalJsonResponse = jsonResponse;
                    console.log(window.globalJsonResponse);
                    window.globalURL = request.url;
                    console.log(window.globalURL);

                    let overlayDiv = document.createElement('div');
                    overlayDiv.id = 'overlayDiv';
                    overlayDiv.style.position = 'absolute';
                    overlayDiv.style.top = '0';
                    overlayDiv.style.left = '0';
                    overlayDiv.style.width = '100%';
                    overlayDiv.style.height = '100%';
                    overlayDiv.style.backgroundColor = 'rgba(0,0,0,0.0)';
                    overlayDiv.style.zIndex = '1000';
                    //overlayDiv.style.opacity = '0.5';
                    overlayDiv.style.pointerEvents = request.layer;
                    overlayDiv.innerHTML = window.globalJsonResponse;
                    document.body.appendChild(overlayDiv);

                    browser.runtime.sendMessage({ action: "displayHTML", html: window.globalJsonResponse });
                    browser.runtime.sendMessage({ action: "done", html: window.globalJsonResponse });
                } else {
                    console.error("Failed to send data to the server");
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
            } catch (error) {
                //console.error("Error sending data to the server:", error);
                browser.runtime.sendMessage({ action: "error", message: error.toString() });
            }
        }

        // DOMContentLoaded
        if (document.readyState === "complete" || document.readyState === "interactive") {
            evaluatePage();
        } else {
            document.addEventListener('DOMContentLoaded', evaluatePage);
        }
    }
});
