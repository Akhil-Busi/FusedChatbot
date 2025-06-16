// client/src/components/MermaidDiagram.js
import React, { useEffect } from 'react';
import mermaid from 'mermaid';
import { useTheme } from '../context/ThemeContext'; // Import our theme hook

// Initialize Mermaid ONCE when the module loads.
// This is more efficient than re-initializing on every render.
// The theme will be set dynamically in the effect.
mermaid.initialize({
    startOnLoad: false, // We will control the rendering manually
    // theme: 'dark', // Theme is now set dynamically below
    securityLevel: 'loose', // Required for dynamic rendering
    fontFamily: 'sans-serif',
    logLevel: 'info', // 'debug' for more details, 'info' for less
    mindmap: {
        padding: 15,
        // You can add more mindmap-specific configurations here
    },
});


const MermaidDiagram = ({ chart }) => {
    const { theme } = useTheme(); // Get the current theme ('light' or 'dark')

   useEffect(() => {
    if (chart) {
        mermaid.initialize({
            startOnLoad: false,
            theme: theme,
            securityLevel: 'loose',
            fontFamily: 'sans-serif',
            logLevel: 'info',
            mindmap: {
                padding: 15,
            },
        });

        try {
            mermaid.run(); // This will throw if the chart has invalid Mermaid syntax
        } catch (err) {
            console.error("Mermaid render error:", err);
            const errContainer = document.querySelector('.mermaid');
            if (errContainer) {
                errContainer.innerHTML = `<div style="color:red;">⚠️ Invalid Mermaid syntax</div>`;
            }
        }
    }
}, [chart, theme]); // Rerun this effect if either the chart data OR the theme changes.

    if (!chart) {
        return <div className="mermaid-error">No mind map data to display.</div>;
    }
    
    // We render a div with the class "mermaid".
    // Inside this div, we place the raw chart text.
    // The mermaid.run() function will find this div and replace its content with the rendered SVG.
    return (
        <div className="mermaid">
            {chart}
        </div>
    );
};

export default MermaidDiagram;