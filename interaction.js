import COLOR_HOVER from "./config.js";


function customizeColor(imageData){
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
}; 


function hover(hoverOverlay){
    // change color
    hoverOverlay.filters([Konva.Filters.RGBA]);
    hoverOverlay.red(COLOR_HOVER[0]);
    hoverOverlay.green(COLOR_HOVER[1]);
    hoverOverlay.blue(COLOR_HOVER[2]);
    hoverOverlay.alpha(COLOR_HOVER[3] * 255);
}


export default {customizeColor, hover}