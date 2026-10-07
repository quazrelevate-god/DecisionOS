package com.decisionos.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * SAFE-AREA (2026-10-07) — keep web content clear of the status bar / camera
 * cutout on EVERY entry, not just the first.
 *
 * The web app relies on CSS env(safe-area-inset-*) for the top/bottom insets.
 * Under the SDK-35+ edge-to-edge layout the WebView draws behind the system
 * bars, and on some OEM WebViews (notably Xiaomi HyperOS) env(safe-area-inset-*)
 * is correct on a cold start but DROPS TO 0 after the app is backgrounded and
 * resumed — so content slides under the status bar on the 2nd+ entry.
 *
 * Fix: read the real system-bar + cutout insets natively and publish them to the
 * page as --android-sa-* CSS variables on every inset change (which includes
 * resume), and re-request them in onResume so it re-applies even when the OEM
 * does not re-dispatch on its own. The stylesheet uses
 *   max(env(safe-area-inset-*), var(--android-sa-*, 0px))
 * so the correct value wins on every device and every entry, while stock
 * Android and iOS keep using env() unchanged.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Edge-to-edge (already the default on Android 15+; set explicitly so the
        // behaviour is consistent) and allow drawing into a display cutout.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        }

        final WebView webView = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            int top = Math.round(bars.top / density);
            int bottom = Math.round(bars.bottom / density);
            int left = Math.round(bars.left / density);
            int right = Math.round(bars.right / density);
            final String js = "(function(){var s=document.documentElement.style;" +
                    "s.setProperty('--android-sa-top','" + top + "px');" +
                    "s.setProperty('--android-sa-bottom','" + bottom + "px');" +
                    "s.setProperty('--android-sa-left','" + left + "px');" +
                    "s.setProperty('--android-sa-right','" + right + "px');})();";
            // The listener runs on the UI thread, but evaluateJavascript must be
            // posted to the WebView to be safe across resume timing.
            webView.post(() -> webView.evaluateJavascript(js, null));
            // Do not consume: let the insets propagate normally.
            return insets;
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        // HyperOS can drop env() after a background trip without re-dispatching
        // insets, so force the listener above to run again on every resume.
        final WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.post(() -> ViewCompat.requestApplyInsets(webView));
        }
    }
}
