
import controlPointsDict from "./mao/controlPoints.json" with { type: "json" };
import { calculateImageSize, loadImg } from "./utils.js";
import interaction from "./interaction.js";

var newControlPointsDict;
var dragStarted;
var domNode;
var nodes, links;
var nodePaths, nodesExit, parentLink;
var pathMaker;

function pathCommandToString(commands) {
    let _ = ""
    commands.forEach(command => {
        _ += `${command.type}${command.x},${command.y}`;
    })
    return _;
}

var Quadtree = d3.quadtree()
    .x(function (d) {
        return d.x;
    })
    .y(function (d) {
        return d.y;
    });


function refreshTreeConfig(t) {
    // merge hierarchy B in hierarchy A as child of nodeOfA
    // see https://observablehq.com/d/c2df560e9434151d   
    t = d3.hierarchy(t);
    t.each((d) => {
        d.data = { ...d.data.data, children: d.children, id: d.data.id, x: d.data.x, y: d.data.y, x0: d.data.x0, y0: d.data.y0 }
    });
    return t;
}


function ancientPath(d, clean = true) {
    const lineIds = d.target.data.controlPoints;
    let ctrl_points = lineIds.map(id => newControlPointsDict[id]);
    // 去除一条水平或垂直线上超过三个点的多余的点，只保留前后两个端点。这样是防止多余的点对后续变换造成差值困难。
    const thred = 1
    const sameX = (a, b) => Math.abs(a[0] - b[0]) <= thred;
    const sameY = (a, b) => Math.abs(a[1] - b[1]) <= thred;
    let removeIndexArray = []
    for (let idx in ctrl_points) {
        idx = +idx;
        if (idx === 0) { continue }
        if (idx === ctrl_points.length - 1) { continue }
        const currentNode = ctrl_points[idx];
        const previousNode = ctrl_points[idx - 1];
        const nextNode = ctrl_points[idx + 1];
        if (sameX(currentNode, previousNode) && sameX(currentNode, nextNode)) {
            removeIndexArray.push(idx)
        }
        if (sameY(currentNode, previousNode) && sameY(currentNode, nextNode)) {
            removeIndexArray.push(idx)
        }
    }
    if (clean) {
        ctrl_points = ctrl_points.filter((_, i) => !removeIndexArray.includes(i))
    }
    return d3.line()(ctrl_points);
}

function resizePoints(originalSize, currentSize, root) {
    let xRatio = currentSize[0] / originalSize[0]
    let yRatio = currentSize[1] / originalSize[1]
    const res = {}
    for (let key of Object.keys(controlPointsDict)) {
        res[key] = [controlPointsDict[key][0] * xRatio, controlPointsDict[key][1] * yRatio]
    }
    root.each(node => {
        node.data._position = [[0, 0], [0, 0]]
        node.data._position[0][0] = node.data.position[0][0] * xRatio
        node.data._position[1][0] = node.data.position[1][0] * xRatio
        node.data._position[0][1] = node.data.position[0][1] * xRatio
        node.data._position[1][1] = node.data.position[1][1] * yRatio
    })
    return res
}

// 该函数称为插值器工厂函数 interpolator factory，它生成一个插值器
// 💡 D3 在 d3-interpolate 模块提供了一些内置插值器，具体可以查看官方文档 https://d3js.org/d3-interpolate
// 或这一篇笔记 https://datavis-note.benbinbin.com/article/d3/core-concept/d3-concept-transition#插值器
// 该函数接收两个参数，第一个参数 `d1` 是过渡的目标值/最终值，第二个参数 `precision` 是采样的精度
// 通过采样将路径从贝塞尔曲线转换为分段折线（便于插值计算）
function smoothTween(d1, precision) {
    // 返回一个自定义的插值器
    return function () {
        // 函数内的 this 指向（在过渡管理器所绑定的选择集合中）当前所遍历的元素，在这个示例中选择集中只有一个 `<path>` 元素
        const path0 = this;
        // 通过 JS 原生方法 node.cloneNode() 拷贝该 DOM 元素
        const path1 = path0.cloneNode();
        // 将该 `<path>` 元素的属性 `d` 设置为 `d1`（过渡的目标值/最终值），所以该元素的形状与过渡完成时的路径形状一样
        path1.setAttribute("d", d1);
        // 使用方法 SVGGeometryElement.getTotalLength() 获取 `<path>` 元素的长度（以浮点数表示）
        const n0 = path0.getTotalLength(); // 过渡起始时路径的总长度
        const n1 = path1.getTotalLength(); // 过渡结束时路径的总长度

        // Uniform sampling of distance based on specified precision.
        // 基于给定的精度 precision 对（过渡前）path0 和（过渡后）path1 两个路径进行均匀采样
        // 💡 可以得到一系列配对的采样点（它们分别是路径上某一点的起始状态和最终状态）
        // 💡 然后为**每对采样点（已知起始状态和最终值）构建一个插值器**，用于实现路径切换动画
        // 用一个数组 distances 来存储采样点（相对于路径的）位置，每一个元素都表示一个采样点
        // 即每个元素/采用点都是一个 0 到 1 的数字，它是采样点到该路径开头的距离与**该路径总长度**的比值（占比）
        // 💡 使用相对值来表示采样点的位置，以便将采样点进行配对
        const distances = [0]; // 第一个采样点是路径的起点
        // 对采样的精度/步长进行标准化，使用它进行迭代采样就可以得到采样点的相对（总路径）位置
        // 其中 precise 的单位是 px 像素，是采样精度的绝对值
        // 通过精度与路径的总长度作比 precise / Math.max(n0, n1) 将精度从绝对值转换为相对值
        // 其中路径总长度是基于变换前后最长的路径，以保证在较长的路径上的采样密度（数量）也是足够
        const dt = precision / Math.max(n0, n1);
        // 通过 while 循环进行采用，每次距离增加一个标准化的步长 dt
        let i = 0; while ((i += dt) < 1) distances.push(i);
        distances.push(1); // 最后一个采样点是路径的终点

        // Compute point-interpolators at each distance.
        // 遍历数组 distances 为不同的采样点构建一系列的插值器
        const points = distances.map((t) => {
            // t 为当前所遍历的采样点的位置的相对值（与它所在的路径总长度的占比）
            // 通过 t * n0 或 t * n1 可以求出该采样点距离 path0 或 path1 路径的起点的具体距离
            // 再使用 SVG 元素的原生方法 path.getPointAtLength(distance) 可以获取距离路径起点特定距离 distance 的位置的具体信息
            // 具体可以参考 https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/getPointAtLength
            // 该方法返回一个 DOMPoint 对象，它表示坐标系中的 2D 或 3D 点，其中属性 x 和 y 分别描述该点的水平坐标和垂直坐标
            // 具体可以参考 https://developer.mozilla.org/en-US/docs/Web/API/DOMPoint
            // 在 path0（过渡开始时的路径）上的采样点作为插值的起始状态
            const p0 = path0.getPointAtLength(t * n0);
            // 在 path1（过渡结束时的路径）上的采样点作为插值的最终状态
            const p1 = path1.getPointAtLength(t * n1);
            // 所以 [p0.0, p0.y] 是插值的起点的坐标值，[p1.x, p1.y] 是插值的终点的坐标值
            // 这里使用 D3 所提供的内置通用插值器构造函数 d3.interpolate(a, b) 来构建一个插值器
            // 它会根据 b 的值类型自动调用相应的数据类型插值器
            // 具体可以参考这一篇笔记 https://datavis-note.benbinbin.com/article/d3/core-concept/d3-concept-transition#通用类型插值器
            // 这里为每个采样位置构建出一个插值器，然后在过渡期间就可以计算出特定时间点该点运动到什么地方（即它的 x，y 坐标值）
            return d3.interpolate([p0.x, p0.y], [p1.x, p1.y]);
        });

        // 插值器最后需要返回一个函数，它接受标准时间 t 作为参数（其值的范围是 [0, 1]）
        // 返回的这个函数会在过渡期间被不断调用，用于生成不同时间点的 `<path>` 元素的属性 `d` 的值
        // 当过渡未结束时（标准化时间 t < 1 时），通过调用一系列的插值器 points 计算各个采样点的运动到何处，并使用指令 `L` 将这些点连起来构成一个折线
        // 而过渡结束时（标准化时间 t = 1 时），将路径替换为真正的形状 d1（而不再使用采样点模拟生成的近似形状）
        return (t) => t < 1 ? "M" + points.map((p) => p(t)).join("L") : d1;
    };
}


function addInterpolateControlPointsToModernPath(ancient_path, modern_path, numberControlPoints) { // 根据古代控制点的纵坐标判断现代添加的控制点是否位置要一致
    let ancientCommand = d3.pathCommandsFromString(ancient_path);
    let modernCommands = d3.pathCommandsFromString(modern_path)
    let start = modernCommands[1]; // 现代垂直直线布局一共有四个控制点，去掉第一个和最后一个，剩余两个之间的线段（横线）用于动画变化。
    let end = modernCommands[2]; //
    let numToAdd = ancientCommand.length - 4; // 根据古代path计算需要多少个添加的控制点。古代控制点总数减去两个端点以及对应现代横线布局的两个端点得到
    numToAdd = numToAdd > 0 ? numToAdd : 0; // 保证添加的端点数大于0
    let removedControlPointsNumber = numberControlPoints - ancientCommand.length;
    // console.log("removedControlPointsNumber", removedControlPointsNumber)
    let minBoundingX = Math.min(ancientCommand[1].x, ancientCommand.at(-2).x)
    let maxBoundingX = Math.max(ancientCommand[1].x, ancientCommand.at(-2).x)

    // 检查古代中间点的x是否有小于起点的x或者大于终点的x
    // 若小于起点的x，则将该x设置为正无穷。若大于终点的x，则设置为负无穷，后面排序会剔除正负无穷。
    ancientCommand.slice(2, numToAdd + 2).forEach((command, i) => {
        if (command.x < minBoundingX || Math.abs(command.x - minBoundingX) < 2) {
            // 古代布局中起点对应POSITIVE_INFINITY 终点对应NEGATIVE_INFINITY
            // ancientCommand[i+2].x = whichAncientPointIsBigger === "startBigger" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
            ancientCommand[i + 2].x = Number.NEGATIVE_INFINITY;
        }
        else if (command.x > maxBoundingX || Math.abs(command.x - maxBoundingX) < 2) {
            // 古代布局中起点对应POSITIVE_INFINITY 终点对应NEGATIVE_INFINITY
            // ancientCommand[i+2].x = whichAncientPointIsBigger === "startBigger" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
            ancientCommand[i + 2].x = Number.POSITIVE_INFINITY;
        }
    })
    let insertPoint = []
    // ancientMiddlePoints先拿到古代线条剔除前两个和后两个的点，并将其按照x大小从大到小排序 e.g. [196, 196, 126] (三个中间点的x坐标)
    let ancientMiddlePoints = ancientCommand
        .slice(2, numToAdd + 2)
        .map(d => d.x)
        .sort((a, b) => b - a);
    ancientMiddlePoints = unifyCloseNumbers(ancientMiddlePoints, 1); // 判断古代布局中垂直的两个点是否在一条垂直线上
    // sortedUnique为ancientMiddlePoints去重后并按照从大到小顺序排序的结果（剔除正负无穷，正负无穷代表的点在后续单独设置位置）,(e.g. [196,126]) 
    const sortedUnique = [...new Set(ancientMiddlePoints)].filter(d => d !== Number.POSITIVE_INFINITY && d !== Number.NEGATIVE_INFINITY).sort((a, b) => b - a);
    // ancientMiddlePoints中点的x坐标对应到直线上的比例为该x坐标在sortedUnique中的index (最终将[196, 196, 126] 转变为e.g. [1,1,2])
    const useWhat = removedControlPointsNumber >= 0 ? removedControlPointsNumber + 1 : numToAdd
    // const useWhat =  numToAdd
    // const useWhat = sortedUnique.length // 适配直接round的版本
    ancientMiddlePoints = ancientMiddlePoints.map(d => {
        if (d === Number.NEGATIVE_INFINITY) {
            // ancientCommand[1].x是起点，对应比例0，数值是0
            // ancientCommand.at(-2).x 是终点，对应比例1，数值是numToAdd + 1
            // 如果起点小于终点，则要将该点投影控制点设置为起点，即0；反之则设置为终点
            return ancientCommand[1].x < ancientCommand.at(-2).x ? 0 : useWhat + 1;
        }
        if (d === Number.POSITIVE_INFINITY) {
            return ancientCommand[1].x > ancientCommand.at(-1).x ? 0 : useWhat + 1;
        }
        else return sortedUnique.indexOf(d) + 1
    });

    if (numToAdd > 0) {
        for (let j = 0; j < numToAdd; j++) {
            // d3.interpolatePathCommands 见 https://github.com/pbeshai/d3-interpolate-path
            let inserPointerMaker = d3.interpolatePathCommands([start], [end]); // 在现代垂直布局path的横线中等距插入点，inserPointerMaker接收0-1之间的数字，返回该比例下的点坐标
            let p = inserPointerMaker((ancientMiddlePoints[j] / (useWhat + 1))); // 直接round
            // let p = inserPointerMaker(ancientMiddlePoints[j] / (useWhat + 1)); // 直接round
            insertPoint.push(p[0])
        }
        modernCommands.splice(2, 0, ...insertPoint);
    }
    return pathCommandToString(modernCommands)
}

function unifyCloseNumbers(array, threshold) {
    // 先对数组进行排序
    array.sort((a, b) => a - b);

    const clusters = [];
    let currentCluster = [array[0]];

    // 遍历数组，将彼此接近的数字划分到同一个组
    for (let i = 1; i < array.length; i++) {
        if (Math.abs(array[i] - currentCluster[currentCluster.length - 1]) < threshold) {
            currentCluster.push(array[i]);
        } else {
            clusters.push(currentCluster);
            currentCluster = [array[i]];
        }
    }

    // 别忘了添加最后一个分组
    clusters.push(currentCluster);

    // 生成结果数组
    const result = clusters.flatMap(cluster => {
        // 计算分组内所有数字的平均值并四舍五入
        const avgValue = Math.round(cluster.reduce((sum, num) => sum + num, 0) / cluster.length);
        return cluster.map(() => avgValue); // 将分组内所有数字替换为平均值
    });

    return result;
}

function elbow(d) {
    let local_ctrl_points;
    local_ctrl_points = [
        [d.source.x, d.source.y],
        [d.source.x, (d.source.y + (d.target.y - d.source.y) / 2)],
        [d.target.x, (d.source.y + (d.target.y - d.source.y) / 2)],
        [d.target.x, d.target.y]
    ]
    return d3.line()(local_ctrl_points)
}


// preprocessing
const padding = {
    top: 0.1,
    bottom: 0.1,
    left: 0.05,
    right: 0.05
}

var imgSize = await calculateImageSize("./mao/img.jpeg", 400)
// Get JSON data
var treeJSON = d3.json("./mao/data.json").then(async (treeData) => {
    // Calculate total nodes, max label length
    var totalNodes = 0;
    var maxLabelLength = 0;
    // variables for drag/drop
    var selectedNode = null;
    var draggingNode = null;
    // panning variables
    var panSpeed = 200;
    var panBoundary = 20; // Within 20px from edges will pan when dragging.
    // Misc. variables
    var i = 0;
    var duration = 1000;
    var node;
    var root;
    var relCoords;
    var linkUpdate, nodeUpdate;
    var mode = "ancient"
    var initSize = [968, 1441];

    // size of the diagram
    var viewerWidth = $(document).width();
    var viewerHeight = $(document).height();
    // Append a group which holds all nodes and which the zoom Listener can act upon.
    var baseSvg = d3.select("#tree-container").append("svg")
        .attr("width", viewerWidth)
        .attr("height", viewerHeight)
        .attr("class", "overlay")
        .on("mousemove", function (event) {
            relCoords = d3.pointer(event);
        }
        );
    var svgGroup = baseSvg.append("g");
    var svgImg = svgGroup.append("image");
    svgImg.attr("href", "./mao/img.jpeg")
        .attr("width", imgSize.newWidth)
        .attr("height", imgSize.newHeight)
        .attr("opacity", 1)
    // .attr("preserveAspectRatio", "none")

    // Define the root
    root = d3.hierarchy(treeData);
    root.x0 = viewerWidth / 2;
    root.y0 = 0;

    // newControlPointsDict = resizePoints(initSize, [viewerWidth, viewerHeight], root);

    var tree = d3.tree()
        .size([viewerWidth, viewerHeight]);
    // .size(initSize);
    // define a d3 diagonal projection for use by the node paths later on.

    var diagonal = d3.linkVertical()
        .x(function (d) { return d.x; })
        .y(function (d) { return d.y; });


    // A recursive helper function for performing some setup by walking through all nodes

    function visit(parent, visitFn, childrenFn) {
        if (!parent) return;

        visitFn(parent);

        var children = childrenFn(parent);
        if (children) {
            var count = children.length;
            for (var i = 0; i < count; i++) {
                visit(children[i], visitFn, childrenFn);
            }
        }
    }
    // console.log(treeData)
    // Call visit function to establish maxLabelLength
    visit(treeData, function (d) {
        totalNodes++;
        maxLabelLength = Math.max(d.name.length, maxLabelLength);

    }, function (d) {
        return d.children && d.children.length > 0 ? d.children : null;
    });


    // sort the tree according to the node names

    function sortTree() {
        tree.sort(function (a, b) {
            return b.name.toLowerCase() < a.name.toLowerCase() ? 1 : -1;
        });
    }
    // Sort the tree initially incase the JSON isn't in a sorted order.
    // sortTree();

    // TODO: Pan function, can be better implemented.

    function pan(domNode, direction) {
        var speed = panSpeed;
        if (panTimer) {
            clearTimeout(panTimer);
            translateCoords = d3.transform(svgGroup.attr("transform"));
            if (direction == 'left' || direction == 'right') {
                translateX = direction == 'left' ? translateCoords.translate[0] + speed : translateCoords.translate[0] - speed;
                translateY = translateCoords.translate[1];
            } else if (direction == 'up' || direction == 'down') {
                translateX = translateCoords.translate[0];
                translateY = direction == 'up' ? translateCoords.translate[1] + speed : translateCoords.translate[1] - speed;
            }
            scaleX = translateCoords.scale[0];
            scaleY = translateCoords.scale[1];
            scale = zom.transform.scale();
            svgGroup.transition().attr("transform", "translate(" + translateX + "," + translateY + ")scale(" + scale + ")");
            d3.select(domNode).select('g.node').attr("transform", "translate(" + translateX + "," + translateY + ")");
            zoomListener.scale(zoomListener.scale());
            zoomListener.translate([translateX, translateY]);
            panTimer = setTimeout(function () {
                pan(domNode, speed, direction);
            }, 50);
        }
    }

    // Define the zoom function for the zoomable tree

    function zoom(e) {
        const transform = d3.zoomTransform(svgGroup.node());
        svgGroup.attr("transform", `translate(${transform.x}, ${transform.y}) scale(${transform.k})`);
    }


    // define the zoomListener which calls the zoom function on the "zoom" event constrained within the scaleExtents
    var zoom = d3.zoom().scaleExtent([1, 3]).on("zoom", zoom);
    baseSvg.call(zoom);

    function initiateDrag(d, domNode) {
        draggingNode = d;
        d3.select(domNode).attr('class', 'node activeDrag');

        svgGroup.selectAll("g.node").sort(function (a, b) { // select the parent and sort the path's
            if (a.id != draggingNode.id) return 1; // a is not the hovered element, send "a" to the back
            else return -1; // a is the hovered element, bring "a" to the front
        });
        // if nodes has children, remove the links and nodes
        if (nodes.length > 1) {
            // remove link paths
            links = nodes[0].links()
            nodePaths = svgGroup.selectAll("path.link")
                .data(links, function (d) {
                    return d.target.id;
                }).remove();
            // remove child nodes
            nodesExit = svgGroup.selectAll("g.node")
                .data(nodes, function (d) {
                    return d.id;
                })
                .filter(d => d.id !== draggingNode.id)
                .remove();
        }

        // remove parent link
        parentLink = nodes[0].parent.links()
        svgGroup.selectAll('path.link').filter(d => d.target.id == draggingNode.id).remove();
        dragStarted = null;
    }

    // Define the drag listeners for drag/drop behaviour of nodes.
    var drag = d3.drag()
        .on("start", function (e, d) {
            if (d == root) {
                return;
            }
            dragStarted = true;
            nodes = d.descendants();
            e.sourceEvent.stopPropagation();
            // 先去除quadtree中被拖拽的节点 否则会一直显示这个节点最近
            quadtree.removeAll(nodes)
            // it's important that we suppress the mouseover event on the node being dragged. Otherwise it will absorb the mouseover event and the underlying node will not detect it d3.select(this).attr('pointer-events', 'none');
        })
        .on("drag", function (e, d) {
            if (d == root) {
                return;
            }
            if (dragStarted) {
                domNode = this;
                initiateDrag(d, domNode);
            }
            //   {  if (relCoords[0] < panBoundary) {
            //         panTimer = true;
            //         pan(this, 'left');
            //     } else if (relCoords[0] > ($('svg').width() - panBoundary)) {
            //         panTimer = true;
            //         pan(this, 'right');
            //     } else if (relCoords[1] < panBoundary) {
            //         panTimer = true;
            //         pan(this, 'up');
            //     } else if (relCoords[1] > ($('svg').height() - panBoundary)) {
            //         panTimer = true;
            //         pan(this, 'down');
            //     } else {
            //         try {
            //             clearTimeout(panTimer);
            //         } catch (e) {

            //         }
            //     }}

            d.x0 = e.x;
            d.y0 = e.y;
            selectedNode = quadtree.find(d.x0, d.y0)
            var node = d3.select(this);
            node.attr("transform", `translate(${d.x0}, ${d.y0})`);
            updateTempConnector();
        })
        .on("end", function (e, d) {
            if (d == root) {
                return;
            }
            domNode = this;
            if (selectedNode) {
                // now remove the element from the parent, and insert it into the new elements children
                var index = draggingNode.parent.children.indexOf(draggingNode);
                if (index > -1) {
                    draggingNode.parent.children.splice(index, 1);
                }
                if (typeof selectedNode.children !== 'undefined' || typeof selectedNode._children !== 'undefined') {
                    if (typeof selectedNode.children !== 'undefined') {
                        selectedNode.children.push(draggingNode);
                    } else {
                        selectedNode._children.push(draggingNode);
                    }
                } else {
                    selectedNode.children = [];
                    selectedNode.children.push(draggingNode);
                }
                // 更新root
                // Make sure that the node being added to is expanded so user can see added node is correctly moved
                expand(selectedNode);
                root = refreshTreeConfig(root);
                quadtree = Quadtree.addAll(root.descendants())
                // sortTree();
                endDrag();
            } else {
                endDrag();
            }
        });

    function endDrag() {
        selectedNode = null;
        d3.select(domNode).attr('class', 'node');
        // now restore the mouseover event or we won't be able to drag a 2nd time
        updateTempConnector();
        if (draggingNode !== null) {
            update(root);
            // centerNode(draggingNode);
            draggingNode = null;
        }
    }

    // Helper functions for collapsing and expanding nodes.
    function collapse(d) {
        if (d.children) {
            d._children = d.children;
            d._children.forEach(collapse);
            d.children = null;
        }
    }

    function expand(d) {
        if (d._children) {
            d.children = d._children;
            d.children.forEach(expand);
            d._children = null;
        }
    }

    // Function to update the temporary connector indicating dragging affiliation
    var updateTempConnector = function () {
        var data = [];
        if (draggingNode !== null && selectedNode !== null) {
            // have to flip the source coordinates since we did this for the existing connectors on the original tree
            data = [{
                source: {
                    x: selectedNode.x0,
                    y: selectedNode.y0
                },
                target: {
                    x: draggingNode.x0,
                    y: draggingNode.y0
                }
            }];
        }

        var link = svgGroup.selectAll(".templink").data(data);


        const enterLink = link.enter().append("path")
            .attr("class", "templink")
            .attr("d", elbow)
            .attr('pointer-events', 'none');

        link.merge(enterLink).attr("d", elbow);

        link.exit().remove();
    };

    // Function to center node when clicked/dropped so node doesn't get lost when collapsing/moving with large amount of children.
    function centerNode(node, init = false) {
        const transform = d3.zoomTransform(baseSvg.node());
        let scale = transform.k;
        let x = -node.x0;
        let y = -node.y0;
        x = x * scale + viewerWidth / 2;
        y = y * scale + (init ? viewerHeight / 5 : viewerHeight / 2);
        baseSvg.transition().duration(duration).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale))
    }

    // Toggle children function
    function toggleChildren(d) {
        if (d.children) {
            d._children = d.children;
            d.children = null;
        } else if (d._children) {
            d.children = d._children;
            d._children = null;
        }
        return d;
    }

    // Toggle children on click.
    function click(e, d) {
        if (e.defaultPrevented) return; // click suppressed
        d = toggleChildren(d);
        update(d);
        centerNode(d);
    }

    d3.select(".btn").on("click", (e) => {
        let calFunc = null;
        if (mode === "modern") {
            calFunc = ancientPath
            mode = "ancient"
        } else if (mode === "ancient") {
            calFunc = elbow
            mode = "modern"
        }
        if (mode === "modern") {
            svgGroup.selectAll("rect")
                .transition()
                .duration(duration)
                .attr("x", d => d.x)
                .attr("y", d => d.y)
                .attr("height", 0)
                .attr("width", 0)
                .attr("opacity", 0)
                .remove();
        }

        linkUpdate.transition()
            .duration(duration)
            .attrTween('d', function (d) {
                let previous = d3.select(this).attr("d");
                let current = calFunc(d);
                if (mode === "modern") {
                    current = addInterpolateControlPointsToModernPath(previous, current, d.target.data.controlPoints.length)
                }
                else {
                    previous = addInterpolateControlPointsToModernPath(current, previous, d.target.data.controlPoints.length)
                }
                return d3.interpolatePath(previous, current);
            })
            .on("end", function (e) { // 
                if (mode === "modern") {
                    d3.select(this).attr("d", d => calFunc(d))
                }
            })


        nodeUpdate.transition()
            .duration(duration)
            .attr("transform", d => {
                if (mode === "ancient") {
                    return `translate(${d.data._position[0][0] + d.data._position[1][0] / 2}, ${d.data._position[0][1] + d.data._position[1][1] / 2})` //  <g>的位置是bbox左上角的位置
                } else {
                    return `translate(${d.x}, ${d.y})`
                }
            })


        if (mode === "ancient") {
            nodeUpdate.each((d, i, nodes) => {
                let r = svgGroup
                    .selectAll(null)
                    .data([d])
                    .enter()
                    .append("rect", d => d)
                    .attr("x", d => d.x)
                    .attr("y", d => d.y)
                    .attr("width", 0)
                    .attr("height", 0)
                    .attr("fill", "none")
                    .attr("stroke", "none")
                    .attr("stroke-width", "1px")
                    .attr("opacity", 0);
                // .remove();

                r.transition().duration(duration)
                    .attr("x", d => d.data._position[0][0])
                    .attr("y", d => d.data._position[0][1])
                    .attr("width", d => d.data._position[1][0])
                    .attr("height", d => d.data._position[1][1])
                    .attr("opacity", 1);

                svgGroup.selectAll(".nodeCircle")
                    .attr("opacity", 0);
            })
            svgGroup.selectAll("image").transition().duration(duration).attr("opacity", 1);
        } else {
            svgGroup.selectAll(".nodeCircle").transition().duration(duration).attr("opacity", 1);
            svgGroup.selectAll("image").transition().duration(duration).attr("opacity", 0);
        }

        // canvas 切换

        // link切换
        var groupOffset = {
            x: imgSize.newWidth * padding.left,
            y: imgSize.newHeight * padding.top,
        }
        root.each(node=>{
            node.x += (mode === "modern" ? groupOffset.x : -groupOffset.x);
            node.y += (mode === "modern" ? groupOffset.y : -groupOffset.y);
        })
        layer.find('.linkPath').forEach(link => {
            let previous = link.data();
            let current = calFunc(link.d);
            if (mode === "modern") {
                current = addInterpolateControlPointsToModernPath(previous, current, link.d.target.data.controlPoints.length)
            }
            else {
                previous = addInterpolateControlPointsToModernPath(current, previous, link.d.target.data.controlPoints.length)
            }
            let tweenFunc = d3.interpolatePath(previous, current);
            gsap.to({}, {
                duration: 1,
                onUpdate: function () {
                    link.data(tweenFunc(this.ratio)); 
                },
                onComplete: () => {
                    if (mode === "modern") {
                        link.data(calFunc(link.d));
                    }
                }
            });
        })
        const nodeAjust = {
            x: -10,
            y: 0
        }
        root.descendants().forEach((_node) => {
            let konvaNode = _node.konvaNode;
            let d = _node.data;
            let tweenFunc = () => {}
            if(mode === "modern"){
                tweenFunc = d3.interpolateArray(d._position[0], [_node.x - d._position[1][0] / 2, _node.y - d._position[1][1] / 2]);
            }else{
                tweenFunc = d3.interpolateArray([konvaNode.x(), konvaNode.y()], d._position[0]);
            }
            gsap.to({}, {
                duration: 1,
                onUpdate: function () {
                    let interPos = tweenFunc(this.ratio);
                    konvaNode.x(interPos[0]); 
                    konvaNode.y(interPos[1]); 
                }
            });
        })
        layer.draw();
    })

    function update(source) {
        // Compute the new height, function counts total children of root node and sets tree height accordingly.
        // This prevents the layout looking squashed when new nodes are made visible or looking sparse when nodes are removed
        // This makes the layout more consistent.
        var levelWidth = [1];
        var childCount = function (level, n) {
            if (n.children && n.children.length > 0) {
                if (levelWidth.length <= level + 1) levelWidth.push(0);

                levelWidth[level + 1] += n.children.length;
                n.children.forEach(function (d) {
                    childCount(level + 1, d);
                });
            }
        };

        childCount(0, root);
        // var newHeight = d3.max(levelWidth) * 60; // 25 pixels per line  
        const treeSize = {
            width: imgSize.newWidth * (1 - padding.left - padding.right),
            height: imgSize.newHeight * (1 - padding.top - padding.bottom),
        }
        // tree.size([imgSize.newWidth, imgSize.newHeight]);
        tree.size([treeSize.width, treeSize.height]);
        // tree.nodeSize([60,120])
        // console.log(newHeight, viewerHeight)
        newControlPointsDict = resizePoints(initSize, [imgSize.newWidth, imgSize.newHeight], root);

        tree(root)
        // console.log(root)
        // Compute the new tree layout.
        var nodes = root.descendants(),
            links = root.links();
        // Set widths between levels based on maxLabelLength.

        // nodes.forEach(function(d) {
        // d.y = (d.depth * (maxLabelLength * 30)); //maxLabelLength * 10px
        // alternatively to keep a fixed scale one can set a fixed depth per level
        // Normalize for fixed-depth by commenting out below line
        // d.y = (d.depth * 500); //500px per level.
        // });

        // nodes…
        {
            node = svgGroup.selectAll("g.node")
            .data(nodes, function (d) {
                return d.id || (d.id = ++i);
            });

        let rect = svgGroup.selectAll("rect")
            .data(nodes, function (d) {
                return d.id || (d.id = ++i);
            })
            ;

        // TODO: ancient下展开节点
        rect.enter()
            .append("rect")
            .attr("x", d => d.data._position[0][0])
            .attr("y", d => d.data._position[0][1])
            .attr("width", d => {
                return d.data._position[1][0]
            })
            .attr("height", d => d.data._position[1][1])
            .attr("fill", "transparent")
            .attr("stroke", "none")
            .attr("stroke-width", "1px")
            .attr("opacity", 1)
            .style("cursor", "pointer")
            .on("mouseover", function (e, d) {
                let linkSelection = d3.selectAll(".link").filter((_, i, nodes) => {
                    return d3.select(nodes[i]).attr("target") === d.data.name
                });
                linkSelection.style("stroke", "red").style("stroke-width", "2px").raise()
            })
            .on("mouseout", function (e, d) {
                let linkSelection = d3.selectAll(".link").filter((_, i, nodes) => {
                    return d3.select(nodes[i]).attr("target") === d.data.name
                });
                linkSelection.style("stroke", "#000").style("stroke-width", "1.5px")
            })

        // console.log(rect)
        rect.exit()
            .transition()
            .duration(duration)
            .attr("x", d => d.x0)
            .attr("y", d => d.y0)
            .attr("height", 0)
            .attr("width", 0)
            .attr("opacity", 0);
        // rect.exit().remove();
        // Enter any new nodes at the parent's previous position.
        var nodeEnter = node.enter().append("g")
            .call(drag)
            .attr("class", "node")
            .attr("transform", function (d) {
                if (mode === "ancient") {
                    return `translate(${source.data._position[0][0] + source.data._position[1][0] / 2}, ${source.data._position[0][1] + source.data._position[1][1] / 2})` //  <g>的位置是bbox左上角的位置
                }
                else return `translate(${source.x0},${source.y0})`; //指定起始位置为source的位置，不影响动画后最终布局
            })
            .on('click', click);


        nodeEnter.append("text")
            .attr("x", function (d) {
                return 0
            })
            .attr('class', 'nodeText')
            .attr("text-anchor", function (d) {
                return "middle"
            })
            .text(function (d) {
                return d.name;
            })
            .style("opacity", 0);

        // Update the text to reflect whether node has children or not.
        nodeEnter.select('text')
            .text(function (d) {
                return d.data.name;
            });

        // Change the circle fill depending on whether it has children and is collapsed
        nodeEnter.select("circle.nodeCircle")
            .attr("r", 8)
            .style("fill", function (d) {
                return d.children ? "lightsteelblue" : "#fff";
            });


        // Transition nodes to their new position. x & y
        nodeUpdate = node.merge(nodeEnter);


        nodeUpdate.transition()
            .duration(duration)
            .attr("transform", function (d) {
                if (mode === "ancient") {
                    return `translate(${d.data._position[0][0] + d.data._position[1][0] / 2}, ${d.data._position[0][1] + d.data._position[1][1] / 2})` // 布局到bbox的左上角 (node <g>的位置)
                } else {
                    return `translate(${d.x}, ${d.y})`
                }
            });

        // Fade the text in
        nodeUpdate.select("text")
            .style("opacity", 0);

        // nodeUpdate.select("rect")

        // Transition exiting nodes to the parent's new position.
        var nodeExit = node.exit().transition()
            .duration(duration)
            .attr("transform", function (d) {
                if (mode === "ancient") {
                    return `translate(${source.data._position[0][0] + source.data._position[1][0] / 2}, ${source.data._position[0][1] + source.data._position[1][1] / 2})` // 布局到bbox的左上角 (node <g>的位置)
                } else {
                    return `translate(${source.x}, ${source.y})`;
                }
            })
            .remove();

        nodeExit.select("circle")
            .attr("r", 0);

        nodeExit.select("text")
            .style("fill-opacity", 0);
        }

        // links
        {
            // Update the links…
            var link = svgGroup.selectAll("path.link")
            .data(links, function (d) {
                return d.target.id;
            });

            // Enter any new links at the parent's previous position.

            const linkEnter = link
                .enter()
                .insert("path", "g")
                .attr("class", "link")
                .attr("target", d => { return d.target.data.name })
                .attr("d", function (d) {
                    var o = {
                        x: source.x0,
                        y: source.y0
                    };
                    if (mode === "ancient") {
                        o.x = source.data._position[0][0] + source.data._position[1][0] / 2;
                        o.y = source.data._position[0][1] + source.data._position[1][1] / 2;
                    }
                    return elbow({
                        source: o,
                        target: o
                    })
                })
                .attr("transform",() => {
                    console.log(mode)
                    return mode === "ancient" ? null : `translate(${treeSize.width * padding.top},${treeSize.width * padding.left})`
                });

            // Transition links to their new position.
            linkUpdate = link.merge(linkEnter);

            linkUpdate.transition()
            .duration(duration)
            .attr("d", function (d) {
                return mode === "ancient" ? ancientPath(d) : elbow(d)
            });

            // Transition exiting nodes to the parent's new position.
            link.exit().transition()
            .duration(duration)
            .attrTween('d', function (d) {
                let previous = d3.select(this).attr("d");
                var o = {
                    x: source.x,
                    y: source.y
                };
                if (mode === "ancient") {
                    o.x = source.data._position[0][0] + source.data._position[1][0] / 2,
                        o.y = source.data._position[0][1] + source.data._position[1][1] / 2
                }
                return d3.interpolatePath(previous, elbow({ source: o, target: o }));
            })
            .remove();
        }

        // Stash the old positions for transition.
        // x0 是旧的x 用于transition
        nodes.forEach(function (d) {
            d.x0 = d.x;
            d.y0 = d.y;
        });
    }

    // Layout the tree initially and center on the root node.
    update(root);
    centerNode(root, true);
    var quadtree = Quadtree.addAll(root.descendants());

    var stage = new Konva.Stage({
        container: 'myCanvas',
        width: 400,
        height: 595,
    });

    var layer = new Konva.Layer();
    const backgroundImg = await loadImg('./mao/background.png');
    const maskImg = await loadImg('./mao/mask.png');
    const background = new Konva.Image({
        x: 0,
        y: 0,
        width: 400,
        height: 595,
        image: backgroundImg,
        draggable: false,
    });
    const maskImage = new Konva.Image({
        image: maskImg,
        draggable: false,
    });
    layer.add(background);

    var nodeGroup = new Konva.Group({
        x: 0,//位置坐标
        y: 0,//位置坐标
    });
    var linkGroup = new Konva.Group({
        x: 0,//位置坐标
        y: 0,//位置坐标
    });

    layer.add(nodeGroup);
    layer.add(linkGroup);
    stage.add(layer);

    {
        maskImage.cache()
        // add node 
        root.descendants().forEach((_node) => {
            let d = _node.data;
            var originalNode = maskImage.clone({
                x: d._position[0][0],
                y: d._position[0][1],
                width: d._position[1][0],
                height: d._position[1][1],
                id: `${d.name}`,
                draggable: true,
                name: 'originalNode',
                // zindex: 1,
            })
            originalNode.crop({
                x: d.position[0][0],
                y: d.position[0][1],
                width: d.position[1][0],
                height: d.position[1][1],
            })
            _node.konvaNode = originalNode;
            originalNode.cache();
            originalNode.on('mouseover', () => {
                let pathToRoot = _node.ancestors();
                let nodeNames = pathToRoot.map(d => d.data.name);
                let konvaNodes = pathToRoot.map(d => d.konvaNode)
                let linkToRoot = stage.find('.linkPath').filter((_, i, nodes) => {
                    return nodeNames.includes(nodes[i].id())
                })
                interaction.highlightLink(linkToRoot)
                interaction.highlightNode(konvaNodes)
                stage.container().style.cursor = 'pointer';
                layer.draw();
            });
            originalNode.on('mouseleave', (e) => {
                let pathToRoot = _node.ancestors();
                let nodeNames = pathToRoot.map(d => d.data.name);
                let konvaNodes = pathToRoot.map(d => d.konvaNode)
                let linkToRoot = stage.find('.linkPath').filter((_, i, nodes) => {
                    return nodeNames.includes(nodes[i].id())
                })
                interaction.recoverLink(linkToRoot);
                interaction.recoverNode(konvaNodes);
                stage.container().style.cursor = 'default';
                layer.draw();
            });
            nodeGroup.add(originalNode);
            layer.draw()
        })
        root.links().forEach((d) => {
            var pathNode = new Konva.Path({
                data: ancientPath(d),
                stroke: '#000000',
                fill: null,
                zindex: 2,
                name: 'linkPath',
                id: d.target.data.name,
            });
            pathNode.d = d;
            linkGroup.add(pathNode);
        })
        layer.draw();
    }
});


// console.log(hoverNode)
// const ctxImage = image.toCanvas().getContext("2d");;
// const imageData = ctxImage.getImageData(0, 0, d._position[1][0], d._position[1][1]);
// const ctxMask = mask.toCanvas().getContext("2d");;
// const maskData = ctxMask.getImageData(0, 0, d._position[1][0], d._position[1][1]);
// const ctxImage = image.toCanvas().getContext("2d");;
// const imageData = ctxImage.getImageData(0, 0, d._position[1][0], d._position[1][1]);
