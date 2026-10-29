package com.decisionos.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.CapConfig;
import java.lang.reflect.Field;

/**
 * The widget's see-through layer. The same app and the same sign-in (one
 * WebView origin, so one stored session), started at /quick instead of /,
 * on a transparent window over the launcher: the web side draws only the dock
 * and whichever of Ask or Decide was tapped, and closing it finishes this
 * activity — back to the home screen, not into the app.
 */
public class DexQuickActivity extends MainActivity {
    public static final String EXTRA_MODE = "mode";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        config = startingAt(path(getIntent()));
        super.onCreate(savedInstanceState);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        WebView webView = getBridge().getWebView();
        if (webView != null) webView.setBackgroundColor(Color.TRANSPARENT);
        seeThrough();
    }

    @Override
    public void onResume() {
        super.onResume();
        seeThrough();
    }

    /* The theme alone was not enough: on the founder's OnePlus (Android 17)
       the window came up marked as covering what is under it, so the launcher
       stopped drawing and the clear ground showed black. Asking for it
       outright keeps the home screen drawn behind. */
    private void seeThrough() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setTranslucent(true);
    }

    /* BridgeActivity puts its own opaque theme on in onCreate; this window
       keeps the translucent one the manifest gave it. */
    @Override
    public void setTheme(int resid) {
        super.setTheme(R.style.AppTheme_DexQuick);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.hasExtra(EXTRA_MODE) && getBridge() != null) {
            getBridge().getWebView().loadUrl(getBridge().getLocalUrl() + path(intent));
        }
    }

    private static String path(Intent intent) {
        String mode = intent == null ? null : intent.getStringExtra(EXTRA_MODE);
        return "/quick?mode=" + ("ask".equals(mode) ? "ask" : "decide");
    }

    /* Capacitor reads its start path from capacitor.config.json, once for the
       whole app; this one activity starts somewhere else. */
    private CapConfig startingAt(String startPath) {
        CapConfig c = CapConfig.loadDefault(this);
        try {
            Field f = CapConfig.class.getDeclaredField("startPath");
            f.setAccessible(true);
            f.set(c, startPath);
        } catch (Exception ignored) {
            // Falls back to "/", which still signs in and shows the app.
        }
        return c;
    }
}
