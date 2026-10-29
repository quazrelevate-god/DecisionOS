package com.decisionos.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * DEX ON THE HOME SCREEN (2026-10-29, founder): "a separate widget… the
 * 'decide or ask' bottom slider… in the transparent background of the home
 * screen launcher itself."
 *
 * A launcher widget only takes taps (no drag), so the slider becomes its two
 * ends and its knob: Ask on the left and Decide on the right each open
 * DexQuickActivity, the same app in a see-through layer over the home screen.
 * The knob wears the app icon and opens the app itself, as the icon would.
 */
public class DexWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_dex);
            views.setOnClickPendingIntent(R.id.widget_ask, open(context, "ask", 1));
            views.setOnClickPendingIntent(R.id.widget_knob, openApp(context));
            views.setOnClickPendingIntent(R.id.widget_decide, open(context, "decide", 3));
            manager.updateAppWidget(id, views);
        }
    }

    private static PendingIntent openApp(Context context) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent == null) intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return PendingIntent.getActivity(context, 2, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent open(Context context, String mode, int code) {
        Intent intent = new Intent(context, DexQuickActivity.class)
                .putExtra(DexQuickActivity.EXTRA_MODE, mode)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        return PendingIntent.getActivity(context, code, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
