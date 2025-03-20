import { COLOR_HOVER, COLOR_HOVER_HEX } from "./config.js";


export default {
    customizeColor:function(imageData){
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const alpha = imageData.data[i+3];
            if (alpha != 0) {
                data[i] = COLOR_HOVER[0]; // 将 alpha 通道设置为 0（透明）
                data[i+1] = COLOR_HOVER[1]; // 将 alpha 通道设置为 0（透明）
                data[i+2] = COLOR_HOVER[2]; // 将 alpha 通道设置为 0（透明）
                data[i+3] = COLOR_HOVER[3] * 255;
            }
        }
    },
    
    highlightNode: function(hoverOverlay){
        // change color
        for (let i = 0; i < hoverOverlay.length; i++) { 
            hoverOverlay[i].filters([Konva.Filters.RGBA]);
            hoverOverlay[i].red(COLOR_HOVER[0]);
            hoverOverlay[i].green(COLOR_HOVER[1]);
            hoverOverlay[i].blue(COLOR_HOVER[2]);
            hoverOverlay[i].alpha(COLOR_HOVER[3] * 255);
        }
    },
    
    highlightLink: function(hoverOverlay){
        for (let i = 0; i < hoverOverlay.length; i++) {
            hoverOverlay[i].setAttrs({
                stroke: COLOR_HOVER_HEX,
                strokeWidth: 2.8,
            })
            hoverOverlay[i].moveToTop()
        }
    },
    
    recoverLink: function(hoverOverlay){
        for (let i = 0; i < hoverOverlay.length; i++) {
            hoverOverlay[i].setAttrs({
                stroke: "#000000",
                strokeWidth: 2,
            })
        }
    },

    recoverNode: function(hoverOverlay){
        for (let i = 0; i < hoverOverlay.length; i++) {
            hoverOverlay[i].filters(null)
        }
    }
}