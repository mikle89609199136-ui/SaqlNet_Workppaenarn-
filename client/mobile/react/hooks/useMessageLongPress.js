import { useRef, useEffect, useCallback } from "react";
import { calculateMenuPosition } from "../utils/calculateMenuPosition";

export const useMessageLongPress = (messageId, selectionMode, onSelection, actionMenu, setActionMenu, message) => {
    const longPressTimerRef = useRef(null);
    const longPressPointRef = useRef(null);
    const suppressNextClickRef = useRef(false);

    // Очистка таймера при размонтировании
    useEffect(() => () => window.clearTimeout(longPressTimerRef.current), []);

    const clearLongPress = useCallback(() => {
        if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    }, []);

    const openMessageActions = useCallback((clientX, clientY) => {
        const { x, y } = calculateMenuPosition(clientX, clientY);
        setActionMenu({ messageId, x, y });
    }, [messageId, setActionMenu]);

    const handleClickCapture = useCallback((event) => {
        if (selectionMode) {
            onSelection(message);
            return;
        }
        if (!suppressNextClickRef.current) return;
        suppressNextClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
    }, [selectionMode, onSelection, message]);

    const handleContextMenu = useCallback((event) => {
        event.preventDefault();
        if (actionMenu) {
            setActionMenu(null)
            return
        }
        openMessageActions(event.clientX, event.clientY);
    }, [openMessageActions, actionMenu, setActionMenu]);

    const handlePointerDown = useCallback((event) => {
        if (event.button !== 0 || (event.pointerType !== "touch" && event.pointerType !== "pen")) return;

        const point = { x: event.clientX, y: event.clientY };
        longPressPointRef.current = point;
        clearLongPress();

        longPressTimerRef.current = window.setTimeout(() => {
            suppressNextClickRef.current = true;
            openMessageActions(point.x, point.y);
        }, 550);
    }, [clearLongPress, openMessageActions]);

    const handlePointerMove = useCallback((event) => {
        if (!longPressTimerRef.current || !longPressPointRef.current) return;

        const deltaX = Math.abs(event.clientX - longPressPointRef.current.x);
        const deltaY = Math.abs(event.clientY - longPressPointRef.current.y);

        if (deltaX > 8 || deltaY > 8) clearLongPress();
    }, [clearLongPress]);

    // Возвращаем хэндлеры для привязки к HTML-элементу
    return {
        onClickCapture: handleClickCapture,
        onContextMenu: handleContextMenu,
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: clearLongPress,
        onPointerCancel: clearLongPress,
        onPointerLeave: clearLongPress,
    };
};
