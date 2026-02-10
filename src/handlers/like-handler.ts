
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { pluginState } from '../core/state';

// Define minimal interfaces for the events we handle
interface BaseEvent {
    post_type: string;
    [key: string]: any;
}

interface NoticeEvent extends BaseEvent {
    post_type: 'notice';
    notice_type: string;
}

// Define a union type for potential like events
type LikeEvent = 
    | (NoticeEvent & { notice_type: 'notify'; sub_type: 'poke'; target_id: number; user_id: number; })
    | (NoticeEvent & { notice_type: 'thumb_up'; user_id: number; target_id: number; count?: number; });

export async function handleLike(ctx: NapCatPluginContext, event: any) {
    const { logger } = ctx;
    
    // Check if it's a like event (or poke for testing/fallback)
    // Note: 'thumb_up' is the standard OneBot/Go-CQHttp event for likes.
    // 'poke' is for "Nudge", often used to test interactions.
    const isLike = (event.notice_type === 'thumb_up') || 
                   (event.notice_type === 'notify' && event.sub_type === 'poke');

    if (!isLike) return;

    // Extract user_id and times
    const user_id = event.user_id;
    // For poke, we treat it as 1 like. For thumb_up, use count or default to 1.
    const times = event.count || 1;

    // Only reply if the target is the bot itself (for poke/like)
    // For thumb_up, target_id is usually the person receiving the like (the bot).
    if (event.target_id !== parseInt(pluginState.selfId)) {
        // If it's not directed at the bot, ignore.
        return;
    }

    // 1. Check if auto-liking is enabled
    if (!pluginState.config.autoLikeEnabled) {
        return;
    }

    logger.info(`收到来自 ${user_id} 的 ${times} 个赞/戳`);

    // 2. Check if user is in blacklist
    if (pluginState.config.blacklist?.includes(user_id)) {
        logger.info(`用户 ${user_id} 在黑名单中，不回赞。`);
        return;
    }

    // 3. Check if user is a friend
    try {
        const friendList = await pluginState.callApi('get_friend_list', {});
        const isFriend = friendList.data.some((friend: any) => friend.user_id === user_id);
        if (!isFriend) {
            logger.info(`用户 ${user_id} 不是好友，不回赞。`);
            return;
        }
    } catch (error) {
        logger.error('获取好友列表失败:', error);
        return; // Fail safely
    }


    // 4. VIP Rule
    try {
        const userInfo = await pluginState.callApi('get_stranger_info', { user_id });
        const isVip = userInfo.data.vip || false; 

        // Requirement: "我不是会员，对面是会员->超过10次之后不点赞"
        // If the target IS a VIP, they might send more than 10 likes.
        // If I am not a VIP (assumed default limitation), I can only send 10.
        // So if target is VIP, we must check our limit.
        if (isVip) {
             const currentLikes = pluginState.getVipLikeCount(user_id);
             if (currentLikes >= pluginState.config.vipLikeLimit) {
                 logger.info(`用户 ${user_id} 是会员，今日已回赞 ${currentLikes} 次，达到限制 (${pluginState.config.vipLikeLimit})。`);
                 return;
             }
        }
    } catch (error) {
        logger.warn(`获取用户 ${user_id} 信息失败，无法检查会员状态。`, error);
    }


    // 5. Perform like
    try {
        // send_like usually takes { user_id, times }
        await pluginState.callApi('send_like', { user_id, times });
        logger.info(`已回赞用户 ${user_id} ${times} 次。`);

        // 6. Update state
        // We track likes for everyone or just VIPs? 
        // The requirement specifically mentions the limit for VIPs (implied context).
        // But to be safe and consistent, we should track for everyone or at least when we checked.
        // Since we only check limit if isVip is true, we should increment if isVip is true.
        // However, to be robust, let's just increment for everyone, it doesn't hurt.
        pluginState.incrementVipLikeCount(user_id);

    } catch (error) {
        logger.error(`回赞用户 ${user_id} 失败:`, error);
    }
}
