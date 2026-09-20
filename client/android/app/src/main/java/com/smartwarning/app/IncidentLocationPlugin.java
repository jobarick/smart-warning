package com.smartwarning.app;

import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS-callable start/stop for IncidentLocationService — see that class's own
 * comment for what it actually does and why. A local, app-specific plugin
 * (not an npm package), so it must be registered explicitly in MainActivity
 * rather than picked up by Capacitor's usual node_modules plugin scan.
 *
 * Deliberately just two methods with no state of their own: which incident
 * is active, when to start and stop, and any retry/error-recovery policy all
 * stay on the JS side (see client/src/lib/nativeForegroundService.ts and its
 * call sites in App.tsx) — this plugin is a thin, dumb bridge, not a second
 * place incident state can drift out of sync with the first.
 */
@CapacitorPlugin(name = "IncidentLocation")
public class IncidentLocationPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, IncidentLocationService.class);
        try {
            ContextCompat.startForegroundService(context, intent);
            call.resolve();
        } catch (Exception e) {
            // Never fatal to the caller: this is a best-effort exemption from
            // background throttling, not the alert path itself. A device on
            // a restrictive OEM battery-saver mode that refuses foreground
            // services here must not be treated as an SOS failure.
            JSObject ret = new JSObject();
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        context.stopService(new Intent(context, IncidentLocationService.class));
        call.resolve();
    }
}
