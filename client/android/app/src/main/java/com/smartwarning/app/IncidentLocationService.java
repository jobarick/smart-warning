package com.smartwarning.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Started only for the duration of an active incident (see
 * IncidentLocationPlugin's start()/stop(), called from App.tsx's trigger()
 * and allClear()), stopped on all-clear.
 *
 * This service does NOT read location itself — it holds a foreground-service
 * slot with the `location` type for as long as it runs, which is what
 * exempts the app from Android's background execution limits while it does.
 * The webview's own geolocation (useSelfTelemetry.ts's watchPosition) and its
 * WebSocket connection (useAlertSocket.ts) are what actually keep working
 * because of that exemption; without a running foreground service of the
 * matching type, Android is free to suspend both the moment the screen locks
 * or the app backgrounds, which is the exact gap this exists to close.
 *
 * Deliberately does nothing more than this. A service that also fetched
 * location natively would need its own Capacitor bridge to hand that reading
 * back into the webview's JS state, which is a materially larger piece of
 * work and a second, independent location pipeline to keep in sync with the
 * first — see SMART_WARNING_FIX_PLAN.md's P1-2 write-up for why that was
 * deliberately scoped out of this pass.
 */
public class IncidentLocationService extends Service {

    private static final String CHANNEL_ID = "sw_incident_location";
    private static final int NOTIFICATION_ID = 8420; // arbitrary, unique within this app

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannel();

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.incident_location_notification_title))
            .setContentText(getString(R.string.incident_location_notification_body))
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW) // informational, not another alert
            .build();

        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        );

        // Not START_STICKY: if the OS kills this process outright, restarting
        // an empty foreground service on its own achieves nothing — only the
        // app itself, coming back because the person reopened it or a push
        // arrived, can meaningfully resume tracking. Restarting an incident
        // that may already be over would also be actively wrong.
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // started, never bound
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.incident_location_channel_name),
            NotificationManager.IMPORTANCE_LOW // visible, silent — this is not the emergency alert itself
        );
        channel.setDescription(getString(R.string.incident_location_channel_description));
        manager.createNotificationChannel(channel);
    }
}
