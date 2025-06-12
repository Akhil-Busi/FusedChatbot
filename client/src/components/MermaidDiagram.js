// client/src/components/MermaidDiagram.js (FIXED and IMPROVED)

import React, { useEffect } from 'react';
import mermaid from 'mermaid';

// Initialize Mermaid ONCE when the module loads.
// This is more efficient than re-initializing on every render.
mermaid.initialize({
    startOnLoad: false, // We will control the rendering manually
    theme: 'dark',
    securityLevel: 'loose', // Required for dynamic rendering
    fontFamily: 'sans-serif',
    logLevel: 'info', // 'debug' for more details, 'info' for less
    mindmap: {
        padding: 15,
        // You can add more mindmap-specific configurations here
    },
});

const MermaidDiagram = ({ chart }) => {
    
    // This effect will run after the component mounts and whenever the chart data changes.
    useEffect(() => {
        // The mermaid.run() function is designed to find all elements with the class 'mermaid'
        // and render them. It's the most reliable way to render in a dynamic framework like React.
        if (chart) {
            // This ensures that rendering happens only after React has updated the DOM with the new chart data.
            mermaid.run();
        }
    }, [chart]); // The dependency array is crucial.

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