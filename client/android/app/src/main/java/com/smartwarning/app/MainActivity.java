package com.smartwarning.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // IncidentLocationPlugin is local to this app, not an installed
        // Capacitor npm plugin, so it needs explicit registration here —
        // Capacitor's automatic plugin discovery only scans node_modules.
        registerPlugin(IncidentLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
